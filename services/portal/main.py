"""Student portal: central Identity is the only human credential authority."""
import hashlib
import json
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlencode

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from redis.asyncio import Redis
from redis.exceptions import RedisError

ORIGIN = os.getenv("PORTAL_ORIGIN", "https://fime.ici-labs.com").rstrip("/")
IDENTITY = os.getenv("IDENTITY_URL", "http://sara-identity:8001").rstrip("/")
AUTH_PORTAL = os.getenv("AUTH_PORTAL_URL", "https://auth.ici-labs.com").rstrip("/")
CLIENT = "student-hub-web"
AUDIENCE = "student-hub"
CALLBACK = ORIGIN + "/session/callback"
COOKIE = "__Host-fime_session"
ATTEMPT = "__Host-fime_attempt"
STATIC = Path(__file__).parent / "static"
APPS = json.loads((Path(__file__).parent / "apps.json").read_text())


@asynccontextmanager
async def lifespan(app):
    app.state.http = httpx.AsyncClient(timeout=20, follow_redirects=False)
    app.state.redis = Redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"), decode_responses=True)
    yield
    await app.state.http.aclose()
    await app.state.redis.aclose()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def cookie(response, name, value, age):
    response.set_cookie(name, value, max_age=age, secure=True, httponly=True, samesite="lax", path="/")


def clear(response, name):
    response.delete_cookie(name, secure=True, httponly=True, samesite="lax", path="/")


def headers(device):
    return {"X-Client-ID": CLIENT, "X-Device-ID": device, "X-Device-Name": "Student Hub Web"}


def csrf(request):
    if request.headers.get("origin") != ORIGIN:
        raise HTTPException(403, "Origen no permitido.")


async def throttle(request, bucket, limit):
    # Do not trust visitor-supplied forwarded headers. Aggregate cap behind tunnel.
    key = f"rate:{bucket}:{digest(request.client.host)}"
    count = await request.app.state.redis.incr(key)
    if count == 1:
        await request.app.state.redis.expire(key, 60)
    if count > limit:
        raise HTTPException(429, "Demasiadas solicitudes. Intenta en un minuto.")


@app.middleware("http")
async def security(request, call_next):
    try:
        response = await call_next(request)
    except (httpx.RequestError, RedisError):
        response = JSONResponse({"detail": "Servicio temporalmente no disponible."}, status_code=503)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    return response


@app.get("/healthz")
async def health(request: Request):
    await request.app.state.redis.ping()
    return {"status": "ok"}


@app.get("/")
@app.get("/aplicaciones")
@app.get("/studenthub")
async def home():
    return FileResponse(STATIC / "index.html")


@app.get("/api/apps")
async def apps():
    return APPS


@app.get("/login")
@app.get("/session/login")
async def login(request: Request):
    await throttle(request, "login", 60)
    if request.headers.get("sec-fetch-site") == "cross-site":
        raise HTTPException(403, "Inicia sesión desde el portal.")
    state, verifier, browser = secrets.token_urlsafe(32), secrets.token_urlsafe(64), secrets.token_urlsafe(32)
    import base64
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    await request.app.state.redis.set("attempt:" + digest(state), json.dumps({"browser": digest(browser), "verifier": verifier}), ex=600)
    response = RedirectResponse(AUTH_PORTAL + "/authorize?" + urlencode({
        "response_type": "code", "client_id": CLIENT, "redirect_uri": CALLBACK,
        "state": state, "code_challenge": challenge, "code_challenge_method": "S256",
    }), status_code=303)
    cookie(response, ATTEMPT, browser, 600)
    return response


async def introspect(request, access):
    return await request.app.state.http.get(IDENTITY + "/auth/introspect", headers={
        "Authorization": "Bearer " + access, "X-Resource-Audience": AUDIENCE,
    })


async def revoke(request, data):
    return await request.app.state.http.post(IDENTITY + "/auth/logout/refresh", json={"refresh_token": data["refresh_token"]}, headers=headers(data["device"]))


@app.get("/session/callback")
async def callback(request: Request, state: str = "", code: str = ""):
    if not state or len(state) > 128 or not code or len(code) > 2048:
        raise HTTPException(400, "Autorización incompleta. Vuelve a iniciar sesión.")
    key = "attempt:" + digest(state)
    raw = await request.app.state.redis.get(key)
    if not raw:
        raise HTTPException(400, "El intento expiró o ya fue utilizado.")
    attempt = json.loads(raw)
    if not secrets.compare_digest(attempt["browser"], digest(request.cookies.get(ATTEMPT, ""))):
        raise HTTPException(400, "El intento no corresponde a este navegador.")
    # Atomically consume before exchanging; a callback cannot be replayed.
    if not await request.app.state.redis.getdel(key):
        raise HTTPException(400, "El intento ya fue utilizado.")
    device = secrets.token_hex(16)
    result = await request.app.state.http.post(IDENTITY + "/oauth/token", data={
        "grant_type": "authorization_code", "code": code, "client_id": CLIENT,
        "redirect_uri": CALLBACK, "code_verifier": attempt["verifier"],
    }, headers=headers(device))
    if not result.is_success:
        raise HTTPException(401, "No se pudo validar el acceso. Vuelve a iniciar sesión.")
    grant = result.json()
    if not all(isinstance(grant.get(k), str) and grant[k] for k in ("access_token", "refresh_token")):
        raise HTTPException(502, "Respuesta de identidad inválida.")
    data = {"access_token": grant["access_token"], "refresh_token": grant["refresh_token"], "device": device}
    profile = await introspect(request, data["access_token"])
    if not profile.is_success:
        await revoke(request, data)
        raise HTTPException(401, "La sesión no está autorizada para este portal.")
    old = request.cookies.get(COOKIE)
    if old:
        old_raw = await request.app.state.redis.getdel("session:" + digest(old))
        if old_raw:
            await revoke(request, json.loads(old_raw))
    sid = secrets.token_urlsafe(48)
    await request.app.state.redis.set("session:" + digest(sid), json.dumps(data), ex=2592000)
    response = RedirectResponse("/aplicaciones", status_code=303)
    clear(response, ATTEMPT)
    cookie(response, COOKIE, sid, 2592000)
    return response


@app.get("/session/me")
async def me(request: Request):
    sid = request.cookies.get(COOKIE, "")
    raw = await request.app.state.redis.get("session:" + digest(sid)) if sid else None
    if not raw:
        raise HTTPException(401, "No hay sesión activa.")
    result = await introspect(request, json.loads(raw)["access_token"])
    if result.status_code == 401:
        raise HTTPException(401, "La sesión requiere renovación.")
    if not result.is_success:
        raise HTTPException(503 if result.status_code >= 500 else 403, "No se pudo verificar la sesión.")
    user = result.json()
    return {"user": {k: user.get(k) for k in ("id", "name", "email")}}


@app.post("/session/refresh")
async def refresh(request: Request):
    csrf(request)
    sid = request.cookies.get(COOKIE, "")
    key = "session:" + digest(sid)
    # Single use refresh tokens: serialize across simultaneous browser tabs.
    async with request.app.state.redis.lock("lock:" + digest(sid), timeout=45, blocking_timeout=3):
        raw = await request.app.state.redis.get(key) if sid else None
        if not raw:
            raise HTTPException(401, "No hay sesión activa.")
        data = json.loads(raw)
        current = await introspect(request, data["access_token"])
        if current.is_success:
            return {"authenticated": True}
        if current.status_code != 401:
            raise HTTPException(503 if current.status_code >= 500 else 403, "No se pudo verificar la sesión.")
        result = await request.app.state.http.post(IDENTITY + "/auth/refresh", json={"refresh_token": data["refresh_token"]}, headers=headers(data["device"]))
        if not result.is_success:
            if result.status_code in (400, 401, 403):
                await request.app.state.redis.delete(key)
            raise HTTPException(401 if result.status_code < 500 else 503, "No se pudo renovar la sesión.")
        grant = result.json()
        data.update(access_token=grant["access_token"], refresh_token=grant["refresh_token"])
        await request.app.state.redis.set(key, json.dumps(data), ex=2592000)
    return {"authenticated": True}


@app.post("/session/logout")
async def logout(request: Request):
    csrf(request)
    sid = request.cookies.get(COOKIE, "")
    key = "session:" + digest(sid)
    async with request.app.state.redis.lock("lock:" + digest(sid), timeout=45, blocking_timeout=3):
        raw = await request.app.state.redis.get(key) if sid else None
        if raw:
            result = await revoke(request, json.loads(raw))
            if result.status_code >= 500:
                raise HTTPException(503, "No se pudo cerrar la sesión central. Intenta de nuevo.")
            await request.app.state.redis.delete(key)
    response = JSONResponse({"authenticated": False})
    clear(response, COOKIE)
    clear(response, ATTEMPT)
    return response


@app.post("/api/chat")
async def chat(request: Request):
    csrf(request)
    await throttle(request, "chat", 60)
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 65536:
            raise HTTPException(413, "Mensaje demasiado largo.")
    try:
        payload = json.loads(body)
    except ValueError:
        raise HTTPException(400, "Mensaje inválido.")
    if not isinstance(payload, dict):
        raise HTTPException(400, "Mensaje inválido.")
    payload["stream"] = False
    result = await request.app.state.http.post("http://fimebot-backend:8043/api/chat", json=payload)
    return JSONResponse(result.json(), status_code=result.status_code)


app.mount("/static", StaticFiles(directory=STATIC), name="static")

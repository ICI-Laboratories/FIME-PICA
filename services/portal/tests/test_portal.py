import json
from contextlib import asynccontextmanager
from urllib.parse import parse_qs, urlparse
import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('student_portal_main', Path(__file__).resolve().parents[1] / 'main.py')
main = importlib.util.module_from_spec(spec)
spec.loader.exec_module(main)
import httpx
import fakeredis.aioredis
import pytest
from fastapi.testclient import TestClient

@pytest.fixture
def client():
    calls = []
    control = {"expired": False, "wrong_audience": False, "refresh_failure": False, "logout_failure": False}
    def upstream(req):
        calls.append(req)
        if req.url.path == '/oauth/token':
            return httpx.Response(200, json={'access_token': 'central-access', 'refresh_token':'central-refresh'})
        if req.url.path == '/auth/introspect':
            assert req.headers['x-resource-audience'] == 'student-hub'
            if control['wrong_audience']:
                return httpx.Response(403)
            if control['expired'] and req.headers['authorization'] == 'Bearer central-access':
                return httpx.Response(401)
            return httpx.Response(200, json={'id':'central-uuid','name':'Estudiante','email':'test@example.invalid'})
        if req.url.path == '/auth/refresh':
            if control['refresh_failure']:
                return httpx.Response(503)
            assert json.loads(req.content)['refresh_token'] == 'central-refresh'
            return httpx.Response(200, json={'access_token':'renewed-access','refresh_token':'renewed-refresh'})
        if req.url.path == '/auth/logout/refresh':
            return httpx.Response(503 if control['logout_failure'] else 204)
        return httpx.Response(404)
    @asynccontextmanager
    async def life(app):
        app.state.redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
        app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        yield
        await app.state.http.aclose()
        await app.state.redis.aclose()
    main.app.router.lifespan_context = life
    with TestClient(main.app, base_url=main.ORIGIN, follow_redirects=False) as c:
        c.identity_calls = calls
        c.control = control
        yield c

def authorize(client):
    r = client.get('/session/login')
    assert r.status_code == 303
    query = parse_qs(urlparse(r.headers['location']).query)
    assert query['client_id'] == ['student-hub-web']
    assert query['code_challenge_method'] == ['S256']
    assert query['redirect_uri'] == [main.CALLBACK]
    assert 'HttpOnly' in r.headers['set-cookie'] and 'Secure' in r.headers['set-cookie']
    return query['state'][0]

def test_public_catalog_no_credentials_and_legacy_removed(client):
    assert client.get('/').status_code == 200
    apps = client.get('/api/apps').json()
    assert {'sara', 'sarapad', 'smartdoc', 'fimebot', 'studenthub', 'mapa', 'profesores'} <= {a['id'] for a in apps}
    assert len({a['id'] for a in apps}) == len(apps)
    assert client.get('/session/me').status_code == 401
    assert client.post('/auth/bypass-login',json={'professor_id':1}).status_code == 404
    assert client.post('/student-auth/login',json={}).status_code == 404

def test_pkce_state_browser_binding_and_replay(client):
    state = authorize(client)
    browser = client.cookies.get(main.ATTEMPT)
    client.cookies.clear()
    assert client.get('/session/callback',params={'state':state,'code':'test'}).status_code == 400
    assert not client.identity_calls
    client.cookies.set(main.ATTEMPT,browser)
    callback = client.get('/session/callback',params={'state':state,'code':'test'})
    assert callback.status_code == 303
    assert 'central-access' not in str(callback.headers)
    assert 'central-refresh' not in str(callback.headers)
    profile = client.get('/session/me')
    assert profile.status_code == 200
    assert profile.json()['user']['id'] == 'central-uuid'
    assert client.get('/session/callback',params={'state':state,'code':'test'}).status_code == 400
    token_requests = [r for r in client.identity_calls if r.url.path == '/oauth/token']
    assert len(token_requests) == 1
    assert b'code_verifier=' in token_requests[0].content
    assert token_requests[0].headers['X-Client-ID'] == 'student-hub-web'

def test_csrf(client):
    for path in ['/session/logout','/session/refresh','/api/chat']:
        assert client.post(path).status_code == 403
        assert client.post(path,headers={'Origin':'https://evil.invalid'}).status_code == 403

def test_logout_revokes_central_session(client):
    state = authorize(client)
    assert client.get('/session/callback',params={'state':state,'code':'test'}).status_code == 303
    r = client.post('/session/logout',headers={'Origin':main.ORIGIN})
    assert r.status_code == 200
    assert client.get('/session/me').status_code == 401
    revokes = [r for r in client.identity_calls if r.url.path == '/auth/logout/refresh']
    assert len(revokes) == 1
    assert json.loads(revokes[0].content)['refresh_token'] == 'central-refresh'

def test_callback_fails_without_parameters(client):
    assert client.get('/session/callback').status_code == 400
    assert not client.identity_calls


def test_refresh_and_second_tab_do_not_reuse_refresh_token(client):
    state = authorize(client)
    assert client.get('/session/callback',params={'state':state,'code':'test'}).status_code == 303
    client.control['expired'] = True
    assert client.get('/session/me').status_code == 401
    assert client.post('/session/refresh',headers={'Origin':main.ORIGIN}).status_code == 200
    assert client.post('/session/refresh',headers={'Origin':main.ORIGIN}).status_code == 200
    assert client.get('/session/me').status_code == 200
    assert len([r for r in client.identity_calls if r.url.path == '/auth/refresh']) == 1


def test_wrong_audience_never_creates_session(client):
    state = authorize(client)
    client.control['wrong_audience'] = True
    assert client.get('/session/callback',params={'state':state,'code':'test'}).status_code == 401
    assert client.get('/session/me').status_code == 401
    assert not client.cookies.get(main.COOKIE)


def test_identity_outage_does_not_report_successful_logout(client):
    state = authorize(client)
    assert client.get('/session/callback',params={'state':state,'code':'test'}).status_code == 303
    client.control['logout_failure'] = True
    assert client.post('/session/logout',headers={'Origin':main.ORIGIN}).status_code == 503
    assert client.get('/session/me').status_code == 200
    client.control['logout_failure'] = False
    assert client.post('/session/logout',headers={'Origin':main.ORIGIN}).status_code == 200


def test_identity_outage_preserves_refresh_for_retry(client):
    state = authorize(client)
    assert client.get('/session/callback',params={'state':state,'code':'test'}).status_code == 303
    client.control.update(expired=True,refresh_failure=True)
    assert client.post('/session/refresh',headers={'Origin':main.ORIGIN}).status_code == 503
    client.control['refresh_failure'] = False
    assert client.post('/session/refresh',headers={'Origin':main.ORIGIN}).status_code == 200

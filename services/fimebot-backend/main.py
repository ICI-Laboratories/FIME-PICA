"""
FimeBot Backend Service
Servicio API para el asistente virtual institucional FimeBot.
Conecta con el gateway de inferencia LLM (AIlauncher / lmserver / OpenAI compatible).
"""

import os
import json
import logging
from pathlib import Path
from typing import List, Optional

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("fimebot-backend")

app = FastAPI(title="FimeBot Backend", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
CONTEXT_PATH = BASE_DIR / "context" / "base_context.txt"

OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "http://llm-gateway:8000/v1").rstrip("/")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "qwen-local")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT", "60.0"))
TEMPERATURE = float(os.getenv("TEMPERATURE", "0.3"))
MAX_TOKENS = int(os.getenv("MAX_TOKENS", "350"))

def load_system_context() -> str:
    if CONTEXT_PATH.exists():
        try:
            return CONTEXT_PATH.read_text(encoding="utf-8").strip()
        except Exception as e:
            logger.error(f"Error reading base context: {e}")
    return "Eres FimeBot, el asistente virtual oficial de la Facultad de Ingeniería Mecánica y Eléctrica (FIME) de la Universidad de Colima."

SYSTEM_CONTEXT = load_system_context()

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    stream: Optional[bool] = False
    think: Optional[bool] = False

@app.get("/health")
def health_check():
    return {"status": "ok", "model": OPENAI_MODEL, "gateway": OPENAI_BASE_URL}

@app.get("/")
def root():
    return {
        "service": "fimebot-backend",
        "status": "running",
        "description": "Asistente Virtual FIME - Universidad de Colima"
    }

@app.post("/api/chat")
async def chat_endpoint(chat_request: ChatRequest, request: Request):
    # Truncar historial a los últimos 6 mensajes para ahorrar tokens
    user_messages = [
        {"role": msg.role, "content": msg.content}
        for msg in chat_request.messages
        if msg.role != "system" and msg.content.strip()
    ][-6:]

    # Inyectar el contexto institucional conciso como system prompt
    payload_messages = [
        {"role": "system", "content": SYSTEM_CONTEXT}
    ]
    payload_messages.extend(user_messages)

    headers = {
        "Content-Type": "application/json"
    }
    if OPENAI_API_KEY:
        headers["Authorization"] = f"Bearer {OPENAI_API_KEY}"

    payload = {
        "model": OPENAI_MODEL,
        "messages": payload_messages,
        "temperature": TEMPERATURE,
        "max_tokens": MAX_TOKENS,
        "stream": bool(chat_request.stream),
    }

    url = f"{OPENAI_BASE_URL}/chat/completions"
    logger.info(f"Forwarding chat request to {url} (stream={chat_request.stream}, max_tokens={MAX_TOKENS})")

    if chat_request.stream:
        async def event_generator():
            try:
                async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
                    async with client.stream("POST", url, json=payload, headers=headers) as resp:
                        if resp.status_code != 200:
                            err_bytes = await resp.aread()
                            logger.error(f"LLM stream error {resp.status_code}: {err_bytes.decode('utf-8', errors='ignore')}")
                            error_payload = json.dumps({
                                "choices": [{"delta": {"content": "Error al comunicar con el asistente virtual."}}]
                            })
                            yield f"data: {error_payload}\n\n"
                            yield "data: [DONE]\n\n"
                            return

                        async for line in resp.aiter_lines():
                            if line:
                                yield f"{line}\n\n"
            except httpx.TimeoutException:
                logger.error("Timeout streaming from LLM gateway")
                error_payload = json.dumps({
                    "choices": [{"delta": {"content": "Tiempo de respuesta agotado."}}]
                })
                yield f"data: {error_payload}\n\n"
                yield "data: [DONE]\n\n"
            except Exception as e:
                logger.exception(f"Unexpected streaming error: {e}")
                error_payload = json.dumps({
                    "choices": [{"delta": {"content": f"Error temporal: {str(e)}"}}]
                })
                yield f"data: {error_payload}\n\n"
                yield "data: [DONE]\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code != 200:
                error_body = resp.text
                logger.error(f"LLM gateway returned status {resp.status_code}: {error_body}")
                raise HTTPException(
                    status_code=502,
                    detail=f"Error en gateway de inferencia: {resp.status_code} - {error_body}"
                )

            data = resp.json()
            choice = data.get("choices", [{}])[0]
            message_obj = choice.get("message", {})
            content = message_obj.get("content", "Sin respuesta disponible.")

            return {
                "message": {
                    "role": "assistant",
                    "content": content
                },
                "done": True
            }

    except httpx.ConnectError as e:
        logger.error(f"Cannot connect to LLM gateway {url}: {e}")
        raise HTTPException(
            status_code=503,
            detail="No se pudo conectar con el servicio de Inteligencia Artificial."
        )
    except httpx.TimeoutException:
        logger.error(f"Timeout waiting for LLM response from {url}")
        raise HTTPException(
            status_code=504,
            detail="Tiempo de espera agotado al consultar el modelo."
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in chat endpoint")
        raise HTTPException(
            status_code=500,
            detail=f"Error interno procesando la respuesta: {str(e)}"
        )

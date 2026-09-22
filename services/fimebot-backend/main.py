"""FIME's free, source-grounded institutional information service.

Facts come from the reviewed local corpus. Optional local inference selects
evidence for career guidance; its output is validated before publication.
"""

import json
import logging
from pathlib import Path
from typing import Literal

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator

from policy import KnowledgeBase, answer_question
from hybrid import HybridResponder

logger = logging.getLogger("fimebot-backend")
MAX_BODY_BYTES = 65_536
KNOWLEDGE_PATH = Path(__file__).resolve().parent / "context" / "knowledge.json"
knowledge = KnowledgeBase.load(KNOWLEDGE_PATH)
hybrid = HybridResponder.from_env()
if knowledge.people is None:
    raise RuntimeError("The verified faculty directory is missing")


class BodySizeLimit:
    """Bound actual bytes before JSON parsing, even without Content-Length."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] != "/api/chat":
            return await self.app(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > MAX_BODY_BYTES:
                response = JSONResponse(
                    status_code=413,
                    content={"detail": "El mensaje es demasiado grande. Envía una consulta más breve."},
                )
                return await response(scope, receive, send)
            if not message.get("more_body", False):
                break

        delivered = False

        async def bounded_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, bounded_receive, send)


app = FastAPI(title="FimeBot · Información de la FIME", version="2.2.0")
app.add_middleware(BodySizeLimit)


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=10_000)

    @field_validator("content")
    @classmethod
    def nonempty_text(cls, value):
        value = value.strip()
        if not value or any(ord(char) < 32 and char not in "\n\r\t" for char in value):
            raise ValueError("Invalid text")
        return value

    @model_validator(mode="after")
    def user_length(self):
        if self.role == "user" and len(self.content) > 1_200:
            raise ValueError("User message too long")
        return self


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    messages: list[ChatMessage] = Field(min_length=1, max_length=13)
    stream: StrictBool = False
    # Retained for client compatibility; routing is always controlled by the server.
    think: StrictBool = False

    @model_validator(mode="after")
    def safe_history(self):
        roles = [message.role for message in self.messages]
        if roles[0] != "user" or roles[-1] != "user":
            raise ValueError("History must begin and end with user")
        if any(role != ("user" if index % 2 == 0 else "assistant") for index, role in enumerate(roles)):
            raise ValueError("History must alternate roles")
        if sum(len(message.content) for message in self.messages) > 32_000:
            raise ValueError("History too long")
        return self


@app.exception_handler(RequestValidationError)
async def invalid_request(_request, _error):
    # Pydantic's default response includes submitted text; do not reflect it.
    return JSONResponse(status_code=422, content={
        "detail": "Envía una pregunta de hasta 1200 caracteres y un historial válido de hasta 13 mensajes."
    })


@app.exception_handler(Exception)
async def unexpected_error(_request, error):
    logger.error("Institutional answer failed (%s)", type(error).__name__)
    return JSONResponse(status_code=500, content={
        "detail": "La información no está disponible en este momento. Inténtalo nuevamente."
    })


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "mode": "verified-knowledge",
        "hybrid_enabled": hybrid.enabled,
        "knowledge_entries": len(knowledge.entries),
        "verified_on": knowledge.verified_on,
        "people_entries": len(knowledge.people.people) if knowledge.people else 0,
        "people_verified_on": knowledge.people.verified_on if knowledge.people else None,
    }


@app.get("/")
def root():
    return {
        "service": "fimebot-backend",
        "status": "running",
        "description": "Guía informativa de la FIME · Universidad de Colima",
        "mode": "verified-knowledge",
    }


@app.post("/api/chat")
async def chat_endpoint(chat_request: ChatRequest):
    user_questions = [message.content for message in chat_request.messages if message.role == "user"]
    result = answer_question(user_questions[-1], user_questions[:-1], knowledge)
    guidance = await hybrid.answer(user_questions[-1], user_questions[:-1], knowledge, result)
    mode = "hybrid-grounded" if guidance is not None else "verified-knowledge"
    if guidance is not None:
        result = guidance
    response = {
        "message": {"role": "assistant", "content": result.content},
        "done": True,
        "mode": mode,
        "topics": result.topics,
        "sources": result.sources,
    }
    if not chat_request.stream:
        return response

    async def events():
        # Preserve the OpenAI-style delta envelope used by the public site.
        event = {"choices": [{"delta": {"content": result.content}}],
                 "sources": result.sources, "topics": result.topics, "mode": mode}
        yield "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-store",
        "X-Accel-Buffering": "no",
    })

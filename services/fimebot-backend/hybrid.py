"""Optional local-model career guidance with a closed, validated output grammar.

The model receives canonical interest labels and at most three reviewed career
profiles, never raw questions or conversation messages. It chooses the ordering
and a literal evidence excerpt. Facts, names, links and explanatory sentences are
validated or rendered by the server. Any uncertainty falls back to the existing
curated answer. The concurrency cap applies per service process, across instances.
"""

import asyncio
import json
import logging
import os
import re
import threading
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

from policy import Answer, KnowledgeBase, answer_question, career_topics, normalize, rejected

logger = logging.getLogger("fimebot.hybrid")
_GATE = threading.BoundedSemaphore(2)
_MAX_RESPONSE_BYTES = 32_768
_MAX_MODEL_TOKENS = 200
_MAX_TOTAL_SECONDS = 12.0
_CAREERS = {"ici", "mechatronics", "mechanical_electrical", "electronics_telecommunications", "data_ai"}

# Avoid sending even mixed factual requests to the model. These always use the
# deterministic people/curriculum/process sources handled by the caller.
_FACTUAL = re.compile(
    r"\b(director\w*|rector\w*|coordinador\w*|profesor\w*|docente\w*|maestr[oa]s?|"
    r"grado\w*|doctor\w*|quien|nombre|fecha\w*|cuando|horario\w*|calendario|"
    r"costos?|precio\w*|pago\w*|cuota\w*|colegiatura|arancel\w*|beca\w*|"
    r"tramite\w*|requisito\w*|admision\w*|ingres\w*|inscrib\w*|inscrip\w*|"
    r"documento\w*|examen\w*|puntaje\w*|promedio|titulacion|egreso|"
    r"semestre\w*|duracion|cuanto dura|cuanto tarda|cuantos? anos|cuantas? horas|"
    r"credito\w*|materia\w*|asignatura\w*|plan(?:es)? de estudios|turno\w*|modalidad|"
    r"servicio social|practicas?|ssc|ssu|siceuc|telefono|correo|contacto|"
    r"direccion|donde esta|laboratorio\w*|instalacion\w*)\b"
)
_COMPARE = re.compile(r"\b(compara\w*|diferencias?|versus|vs)\b")
_GUIDANCE = re.compile(
    r"\b(conviene|convendria|recomiendas?|recomendarias?|recomendacion|"
    r"elegir|escojo|escoger|decidir|me gusta\w*|me interesa\w*|prefiero|"
    r"que carrera|cual carrera|quiero dedicarme|trabajar con)\b"
)
_FOLLOWUP = re.compile(r"^[¿¡\s]*(?:y\s+)?(?:cual me conviene|cual elegir|que me recomiendas|compara esas carreras)[\s?!¿¡.,]*$")
_NEGATED_PREFERENCE = re.compile(
    r"\b(no me (?:gusta\w*|interesa\w*|atrae)|no (?:quiero|deseo|prefiero)|"
    r"pero no|odio|detesto|descarto|sin interes|evitar|excepto|menos que)\b"
)


@dataclass(frozen=True)
class Interest:
    label: str
    pattern: str
    # Ranking here only selects candidate profiles. The model chooses final order.
    careers: tuple[str, ...]
    evidence_pattern: str


_INTERESTS = {
    "web": Interest("crear páginas y aplicaciones web", r"\b(web|paginas? web|sitios? web|frontend|backend|front end|back end)\b", ("ici",), r"\b(software|programacion|sistemas informaticos)\b"),
    "programming": Interest("la programación y el desarrollo de software", r"\b(programa(?:r|cion)|software|aplicaciones|computadoras)\b", ("ici", "data_ai"), r"\b(programacion|software|sistemas informaticos)\b"),
    "robotics": Interest("la robótica y la automatización", r"\b(robots?|robotica|automatizacion|automatizar)\b", ("mechatronics",), r"\b(roboticos|robotica|automatizacion|mecatronicos)\b"),
    "electronics": Interest("la electrónica y los sistemas de hardware", r"\b(electronica|hardware|circuitos|microcontroladores)\b", ("electronics_telecommunications", "mechatronics"), r"\b(electronicos|electronica|circuitos|sensores|actuadores|microcontroladores)\b"),
    "ai": Interest("la inteligencia artificial y los sistemas inteligentes", r"\b(inteligencia artificial|ia|sistemas inteligentes|aprendizaje de maquina)\b", ("ici", "data_ai"), r"\b(inteligencia artificial|sistemas inteligentes|aprendizaje de maquina|redes neuronales)\b"),
    "data": Interest("el análisis y la ingeniería de datos", r"\b(datos|estadistica|analisis de informacion)\b", ("data_ai", "ici"), r"\b(datos|estadistica|informacion)\b"),
    "energy": Interest("los sistemas eléctricos y la energía", r"\b(electricidad|energia|electrico\w*|electricista|motores)\b", ("mechanical_electrical",), r"\b(electricas?|electricos?|energia|electromecanicos)\b"),
    "mechanics": Interest("el diseño mecánico y las máquinas", r"\b(mecanica|mecanico|maquinas|diseno mecanico)\b", ("mechanical_electrical", "mechatronics"), r"\b(mecanicos|mecanica|maquinas|estatica|dinamica|dibujo)\b"),
    "networks": Interest("las redes y las telecomunicaciones", r"\b(redes|telecomunicaciones|comunicaciones|telefonia)\b", ("electronics_telecommunications", "ici"), r"\b(redes|telecomunicaciones|comunicaciones|telefonia)\b"),
}
_FOCUS = {
    "ici": ("el desarrollo de software y los sistemas inteligentes", r"\b(software|sistemas inteligentes|programacion)\b"),
    "mechatronics": ("la robótica y la automatización", r"\b(roboticos|mecatronicos|automatizacion)\b"),
    "mechanical_electrical": ("los sistemas mecánicos y la energía", r"\b(mecanicos|energia|electricas)\b"),
    "electronics_telecommunications": ("la electrónica y las telecomunicaciones", r"\b(electronicos|electronica|telecomunicaciones)\b"),
    "data_ai": ("los datos y la inteligencia artificial", r"\b(datos|inteligencia artificial|aprendizaje de maquina)\b"),
}


@dataclass(frozen=True)
class Intent:
    mode: str
    topics: tuple[str, ...]
    interests: tuple[str, ...]


def _intent(question: str, history: list[str], knowledge: KnowledgeBase, deterministic: Answer) -> Intent | None:
    query = normalize(question)
    if _FOLLOWUP.fullmatch(query) and history and not deterministic.topics:
        # Re-evaluate only the prior USER question through the deterministic
        # policy. An assistant message or generated answer is never used here.
        deterministic = answer_question(history[-1], history[:-1], knowledge)
    # Never override an existing refusal, people answer or administrative result.
    if not deterministic.topics or any(topic not in _CAREERS | {"careers"} for topic in deterministic.topics):
        return None
    if rejected(query) or _FACTUAL.search(query) or _NEGATED_PREFERENCE.search(query):
        return None
    queries = [query]
    if _FOLLOWUP.fullmatch(query) and history:
        previous = normalize(history[-1])
        if rejected(previous) or _FACTUAL.search(previous) or _NEGATED_PREFERENCE.search(previous):
            return None
        queries.append(previous)
    combined = " ".join(queries)
    compare = bool(_COMPARE.search(query))
    if not compare and not _GUIDANCE.search(query):
        return None
    named = career_topics(combined)
    interests = [key for key, item in _INTERESTS.items() if re.search(item.pattern, combined)]
    for key in interests:
        # Be conservative until contrast/negation preferences have a dedicated
        # representation. Never turn an explicit dislike into a recommendation.
        if re.search(r"\b(?:no|sin|nunca)\s+(?:la\s+|el\s+)?(?:" + _INTERESTS[key].pattern + ")", combined):
            return None
    # A web query already expresses programming more specifically. This prevents
    # a third data-science profile from crowding out the robotics/web comparison.
    if "web" in interests and "programming" in interests:
        interests.remove("programming")
    if not interests and len(named) < 2:
        return None
    candidates = list(named)
    # Represent each stated interest before adding secondary candidate degrees.
    for key in interests:
        candidates.append(_INTERESTS[key].careers[0])
    for key in interests:
        candidates.extend(_INTERESTS[key].careers[1:])
    candidates = list(dict.fromkeys(topic for topic in candidates if topic in knowledge.entries))[:3]
    if not candidates or (compare and len(candidates) < 2):
        return None
    return Intent("comparison" if compare else "guidance", tuple(candidates), tuple(interests))


def _explanation(label: str) -> str:
    return f"Podrías explorar esta opción si te interesa {label}."


def _options(intent: Intent, topic: str) -> dict[str, tuple[str, str]]:
    options = {
        key: (_explanation(_INTERESTS[key].label), _INTERESTS[key].evidence_pattern)
        for key in intent.interests if topic in _INTERESTS[key].careers
    }
    if intent.mode == "comparison" or not options:
        label, pattern = _FOCUS[topic]
        options["career_focus"] = (_explanation(label), pattern)
    return options


def _evidence(entry) -> list[str]:
    """Extract reviewed lines verbatim; no model-written claim is ever accepted."""
    lines = [line.removeprefix("- ").strip() for line in entry.text.splitlines()]
    preferred = [line for line in lines if line.startswith(("Formación:", "Campo laboral:", "El plan incluye"))]
    return [line for line in preferred if 25 <= len(line) <= 280][:2]


_SYSTEM = """Orienta sobre carreras de FIME, Universidad de Colima. Ordena candidatos
por afinidad con los intereses; elige evidencia que respalde la relación. Usa sólo
los datos proporcionados. Devuelve JSON: {"recommendations":[{"topic_id":"ici",
"interest_id":"web","evidence_id":1}]}. Máximo tres recomendaciones, sin repetir
carrera. Para comparison debes comparar TODOS los candidatos, aunque interests sea
vacío; en ese caso utiliza career_focus para explicar el enfoque de cada perfil.
topic_id y interest_id deben pertenecer al candidato; evidence_id debe estar en
allowed_evidence de ese interés. En guidance cubre los intereses distintos.
No añadas claves ni texto. Los títulos, citas literales y explicación se completan
en el servidor. No inventes datos ni recomiendes una afinidad sin evidencia."""


class HybridResponder:
    def __init__(self, *, enabled=False, base_url="http://llm-gateway:8000/v1", api_key="", model="qwen-local", transport=None, timeout=12.0):
        self.enabled = bool(enabled)
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.transport = transport
        self.timeout = min(max(float(timeout), 0.01), _MAX_TOTAL_SECONDS)
        parsed = urlsplit(self.base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            self.enabled = False

    @classmethod
    def from_env(cls):
        return cls(
            enabled=os.getenv("FIMEBOT_HYBRID_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"},
            base_url=os.getenv("LLM_GATEWAY_BASE_URL", "http://llm-gateway:8000/v1"),
            api_key=os.getenv("LLM_GATEWAY_API_KEY", ""),
            model=os.getenv("OPENAI_MODEL", "qwen-local"),
        )

    def _payload(self, intent: Intent, knowledge: KnowledgeBase) -> dict:
        canonical = {
            "task": intent.mode,
            "interests": [{"id": key, "label": _INTERESTS[key].label} for key in intent.interests],
            "candidates": [{
                "topic_id": topic,
                "title": knowledge.entries[topic].title,
                "evidence": _evidence(knowledge.entries[topic]),
                "allowed_interests": {key: (_FOCUS[topic][0] if key == "career_focus" else _INTERESTS[key].label) for key in _options(intent, topic)},
                "allowed_evidence": {key: [index for index, evidence in enumerate(_evidence(knowledge.entries[topic])) if re.search(option[1], normalize(evidence))] for key, option in _options(intent, topic).items()},
            } for topic in intent.topics],
        }
        schema = {
            "type": "object",
            "properties": {"recommendations": {
                "type": "array",
                "minItems": len(intent.topics) if intent.mode == "comparison" else 1,
                "maxItems": len(intent.topics),
                "items": {
                    "type": "object",
                    "properties": {
                        "topic_id": {"type": "string", "enum": list(intent.topics)},
                        "interest_id": {"type": "string", "enum": sorted({key for topic in intent.topics for key in _options(intent, topic)})},
                        "evidence_id": {"type": "integer", "minimum": 0, "maximum": 1},
                    },
                    "required": ["topic_id", "interest_id", "evidence_id"],
                    "additionalProperties": False,
                },
            }},
            "required": ["recommendations"],
            "additionalProperties": False,
        }
        return {
            "model": self.model,
            "messages": [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": json.dumps(canonical, ensure_ascii=False)}],
            "temperature": 0.1,
            "max_tokens": _MAX_MODEL_TOKENS,
            "stream": False,
            "response_format": {"type": "json_schema", "json_schema": {
                "name": "career_guidance", "strict": True, "schema": schema,
            }},
        }

    def _validate(self, raw: str, intent: Intent, knowledge: KnowledgeBase) -> Answer | None:
        if not isinstance(raw, str) or len(raw) > 8_000:
            return None
        try:
            # Duplicate keys are rejected, rather than silently keeping the last.
            def unique_keys(pairs):
                value = {}
                for key, item in pairs:
                    if key in value:
                        raise ValueError("Duplicate JSON key")
                    value[key] = item
                return value
            data = json.loads(raw, object_pairs_hook=unique_keys)
        except (ValueError, TypeError):
            return None
        if not isinstance(data, dict) or set(data) != {"recommendations"}:
            return None
        rows = data["recommendations"]
        if not isinstance(rows, list) or not 1 <= len(rows) <= len(intent.topics):
            return None
        if intent.mode == "comparison" and len(rows) != len(intent.topics):
            return None
        selected = []
        sources = []
        seen = set()
        blocks = ["**Orientación según tus intereses**\n\nEstas opciones podrían encajar contigo:"]
        for row in rows:
            if not isinstance(row, dict) or set(row) != {"topic_id", "interest_id", "evidence_id"}:
                return None
            topic, interest, evidence_id = (row[key] for key in ("topic_id", "interest_id", "evidence_id"))
            if not isinstance(topic, str) or not isinstance(interest, str) or type(evidence_id) is not int:
                return None
            if topic not in intent.topics or topic in selected:
                return None
            options = _options(intent, topic)
            if interest not in options:
                return None
            entry = knowledge.entries[topic]
            snippets = _evidence(entry)
            if not 0 <= evidence_id < len(snippets):
                return None
            evidence = snippets[evidence_id]
            explanation, evidence_pattern = options[interest]
            if evidence not in entry.text or not re.search(evidence_pattern, normalize(evidence)):
                return None
            # Evidence is source-exact, not generated. Reject unexpected markup
            # in future corpus updates before rendering it as a quoted snippet.
            if re.search(r"https?://|www\.|[<>\[\]`]", evidence):
                return None
            selected.append(topic)
            blocks.append(f"**{entry.title}**\n{explanation}\n\nLa ficha oficial indica: «{evidence}»")
            links = []
            for source in entry.sources:
                links.append(f"[{source['title']}]({source['url']})")
                if source["url"] not in seen:
                    sources.append(source)
                    seen.add(source["url"])
            blocks.append("Fuentes oficiales: " + " · ".join(links))
        # One degree can cover several interests (e.g. AI and data). Unrelated
        # interests such as web and robotics need relevant alternatives.
        if any(not any(topic in _INTERESTS[key].careers for topic in selected) for key in intent.interests):
            return None
        blocks.append("Es una sugerencia de orientación, basada en esas fichas. Revisa los planes completos para decidir qué enfoque prefieres.")
        return Answer("\n\n".join(blocks), selected, sources)

    async def answer(self, question: str, history: list[str], knowledge: KnowledgeBase, deterministic: Answer) -> Answer | None:
        if not self.enabled:
            return None
        intent = _intent(question, history, knowledge, deterministic)
        if intent is None or not _GATE.acquire(blocking=False):
            return None
        try:
            async with asyncio.timeout(self.timeout):
                headers = {"Content-Type": "application/json"}
                if self.api_key:
                    headers["Authorization"] = "Bearer " + self.api_key
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(self.timeout, connect=min(3.0, self.timeout)),
                    follow_redirects=False, trust_env=False, transport=self.transport,
                ) as client:
                    async with client.stream("POST", self.base_url + "/chat/completions", headers=headers, json=self._payload(intent, knowledge)) as response:
                        if response.status_code != 200:
                            return None
                        content = bytearray()
                        async for chunk in response.aiter_bytes():
                            content.extend(chunk)
                            if len(content) > _MAX_RESPONSE_BYTES:
                                return None
                data = json.loads(content)
                if not isinstance(data, dict) or not isinstance(data.get("choices"), list) or not data["choices"]:
                    return None
                choice = data["choices"][0]
                if not isinstance(choice, dict):
                    return None
                if choice.get("finish_reason") not in {None, "stop"}:
                    return None
                message = choice["message"]
                if not isinstance(message, dict):
                    return None
                if message.get("tool_calls") or message.get("function_call"):
                    return None
                result = self._validate(message["content"], intent, knowledge)
                if result is None:
                    logger.info("Career guidance fell back after output validation")
                return result
        except (httpx.HTTPError, TimeoutError, ValueError, KeyError, IndexError, TypeError):
            # Never expose gateway errors, URLs, credentials or user text.
            logger.info("Career guidance unavailable; using reviewed answer")
            return None
        finally:
            _GATE.release()

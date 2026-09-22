"""Closed-corpus routing: untrusted input can select facts, never create them."""

import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from people import PeopleDirectory, answer_people


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.casefold())
    value = "".join(char for char in value if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", value).strip()


def matches(pattern: str, query: str) -> bool:
    return re.search(pattern, query) is not None


@dataclass(frozen=True)
class Entry:
    id: str
    title: str
    text: str
    aliases: tuple[str, ...]
    keywords: tuple[str, ...]
    sources: tuple[dict, ...]


@dataclass(frozen=True)
class KnowledgeBase:
    institution: str
    verified_on: str
    entries: dict[str, Entry]
    people: PeopleDirectory | None = None

    @classmethod
    def load(cls, path: Path):
        data = json.loads(path.read_text(encoding="utf-8"))
        entries = {}
        for row in data["entries"]:
            if not re.fullmatch(r"[a-z][a-z0-9_]*", row["id"]) or row["id"] in entries:
                raise ValueError("Invalid or duplicate knowledge id")
            if not row["title"].strip() or not row["text"].strip() or not row["sources"]:
                raise ValueError("Knowledge entries need text and sources")
            if len(row["text"]) > 6_000:
                raise ValueError("Knowledge entry too long")
            sources = []
            for source in row["sources"]:
                url = urlsplit(source["url"])
                host = url.hostname or ""
                if url.scheme != "https" or not (host == "ucol.mx" or host.endswith(".ucol.mx")):
                    raise ValueError("Knowledge source must use an official UCOL HTTPS URL")
                if url.username or url.password or not source["title"].strip():
                    raise ValueError("Invalid source")
                sources.append({"title": source["title"], "url": source["url"]})
            entries[row["id"]] = Entry(
                row["id"], row["title"], row["text"], tuple(row.get("aliases", [])),
                tuple(row.get("keywords", [])), tuple(sources),
            )
        if not entries:
            raise ValueError("Empty knowledge base")
        people_path = path.parent / "people.json"
        people = PeopleDirectory.load(people_path) if people_path.exists() else None
        return cls(data["institution"], data["verified_on"], entries, people)


@dataclass(frozen=True)
class Answer:
    content: str
    topics: list[str]
    sources: list[dict]


SCOPE_MESSAGE = (
    "Puedo orientarte sobre la **FIME de la Universidad de Colima**: carreras, planes de estudio, "
    "admisión, becas, trámites, instalaciones y contacto. "
    "Solo respondo consultas de esos temas. Prueba con «¿Qué carreras ofrece la FIME?» "
    "o «¿Cómo ingreso?»."
)
UNKNOWN_MESSAGE = (
    "No tengo ese dato específico verificado. Puedes consultar el "
    "[portal oficial de la FIME](https://portal.ucol.mx/fime/) y confirmar la información con el plantel. "
    "También puedo ayudarte con carreras, admisión, becas, trámites y ubicación."
)

# These patterns improve rejection UX. Factual answers render reviewed entries;
# hybrid guidance separately validates evidence and never receives raw user text.
REJECT_PATTERNS = (
    r"\b(ignora|ignorar|olvida|olvidar|omite|desobedece|ignore|forget|override)\b.{0,90}\b(todo|anterior|instrucciones|reglas|prompt|contexto|previous|instructions|rules|system)\b",
    r"\b(prompt|system prompt|developer message|jailbreak|dan mode|modo desarrollador|instrucciones internas|mensaje del sistema)\b",
    r"\b(actua|actues|comportate|finge|pretend|roleplay)\b.{0,60}\b(como|ser|as)\b",
    r"\b(cambia|cambiar|asume)\b.{0,35}\b(rol|identidad|instrucciones)\b",
    r"\b(base64|rot13|decodifica|decode|ejecuta|execute|evalua este codigo|repite exactamente)\b",
    r"\b(sudo|curl|wget|api[_ -]?key|clave (?:api|secreta)|token secreto)\b|<\s*(?:script|system|developer)\b",
    r"\b(chistes?|poemas?|cuentos?|recetas?|horoscopo|astrologia|apuestas?|casino|futbol|bitcoin|criptomonedas?|porno|pornografia)\b",
    r"\b(clima|pronostico del tiempo|presidente de|elecciones|partido politico|peliculas?|netflix|videojuegos?)\b",
    r"\b(capital de|quien gano|quien descubrio|quien invento|cuanto es|a partir de ahora|from now on)\b",
    r"\b(resuelve|calcula|deriva|integra|traduce|translate|solve|calculate)\b",
    r"\b(escribe|escribeme|redacta|genera|hazme|crea|dame)\b.{0,45}\b(codigo|script|programa en|ensayo|cancion|poema|cuento|receta)\b",
    r"\b(codigo (?:en|de|para)|hacer (?:mi|la|una) tarea|(?:mi|esta) tarea|ejercicio de|problema de matematicas)\b",
    r"\b(ensename|explicame|explica|como)\b.{0,30}\b(hackear|robar|fabricar|cocinar|programar|resolver|hacer una bomba)\b",
    r"\b(uanl|universidad autonoma de nuevo leon|nuevo leon)\b",
)

CAREER_PATTERNS = {
    "ici": r"\b(ici|computacion inteligente|ingenieria en computacion|sistemas computacionales)\b",
    "mechatronics": r"\b(im|imeca|mecatronica|ingenieria mecatronica)\b",
    "mechanical_electrical": r"\b(ime|mecanico electricista|mecanica electrica|mecanica y electrica|ingenieria mecanica)\b",
    "electronics_telecommunications": r"\b(iset|sistemas electronicos|ingenieria en electronica|telecomunicaciones)\b",
    "data_ai": r"\b(idia|ingenieria de datos|datos e inteligencia artificial|datos y (?:la )?inteligencia artificial|(?:carreras?|estudiar|estudia|estudiarse|modalidad|licenciaturas?) en linea|(?:estudiar|carreras?) a distancia)\b",
}

TOPIC_PATTERNS = {
    "careers": r"\b(carreras?|licenciaturas?|ingenierias|oferta (?:educativa|academica)|que (?:puedo|se puede) estudiar|opciones (?:de|para) estudiar)\b",
    "admissions": r"\b(admision|admisiones|ingresar|ingreso|entrar|inscribir(?:me|se)?|inscribo|inscripcion|aspirantes?|exani|ceneval|fichas?|convocatoria|requisitos|cuanto cuesta|costos?|colegiatura|cuotas?|pago|arancel|precio|puntaje|promedio minimo)\b",
    "postgraduate": r"\b(posgrados?|postgrados?|maestrias?|doctorados?|mip|mia|ingenieria aplicada|ingenieria de procesos)\b",
    "scholarships": r"\b(becas?|sibeucol|apoyo (?:economico|alimentario)|manutencion)\b",
    "school_services": r"\b(siceuc|kardex|calificaciones|constancias?|reinscripcion|reinscribirme|tramites?|servicios escolares|boleta|control escolar|certificado|contrasena|password|darme de baja|baja temporal)\b",
    "graduation": r"\b(titulacion|titularme|titularse|titulo|cedula|egreso|egresados|egel|tesis|tesina)\b",
    "social_service": r"\b(servicio social|servicios sociales|ssu|ssc|horas de servicio|liberar servicio)\b",
    "professional_practice": r"\b(practicas?(?: profesionales?)?|estancias? profesionales?|pasantias?|unidad receptora|residencias)\b",
    "mobility": r"\b(movilidad|intercambios?|extranjero|erasmus)\b",
    "student_resources": r"\b(recursos|plataformas?|evpraxis|educ|correo (?:universitario|institucional)|office|microsoft|ingles|flex|tutorias?|tutor|asesorias?|biblioteca|libros|psicologia|apoyo psicologico|actividades culturales|deportes?|acreditaciones)\b",
    "facilities": r"\b(laboratorios?|instalaciones|infraestructura|talleres?|cafeteria|isaac|brenda|chacuaco|canchas|auditorio|aulas|salones|edificio)\b",
    "calendar": r"\b(calendario|vacaciones|horarios?|examenes|extraordinarios|evaluaciones|asueto|inicio de clases|regreso a clases|cuando (?:empiezan|inician|comienzan) las clases|periodo escolar)\b",
    "contact": r"\b(contacto|contactar|telefono|telefonos|llamar|correo|email|e-mail|director|directora|directorio|coordinador|coordinadora|secretaria|horario de atencion)\b",
    "location": r"\b(ubicacion|direccion|mapa|como llego|como llegar|donde (?:esta|queda|se encuentra|se ubica)|campus|coquimatlan|transporte|autobus|camion|ruta)\b",
}

INSTITUTION_PATTERN = r"\b(fime|facultad|universidad de colima|ucol|udec)\b"
OVERVIEW_PATTERN = r"\b(que es|quienes son|acerca de|sobre (?:la )?fime|conocer|informacion (?:de|sobre)|hablame de|historia|fundacion|se fundo)\b"
FOLLOWUP_PATTERN = (
    r"^[¿¡\s]*(?:y\s+)?(?:cuanto dura|cuantos semestres|que duracion tiene|cuantos anos|"
    r"(?:el |su )?plan(?: de estudios)?|duracion|(?:y )?las materias|que materias (?:tiene|lleva)|"
    r"donde puedo trabajar|(?:su |el )?campo laboral|que salidas tiene|mas informacion|"
    r"dime mas|cuentame mas|mas detalles|y esa|y esta|y sus requisitos)[\s?!¿¡.,]*$"
)


def rejected(query: str) -> bool:
    return any(matches(pattern, query) for pattern in REJECT_PATTERNS)


def career_topics(query: str) -> list[str]:
    # The faculty's full name is not a request about the IME degree.
    degree_query = re.sub(r"facultad de ingenieria mecanica y electrica", "fime", query)
    return [key for key, pattern in CAREER_PATTERNS.items() if matches(pattern, degree_query)]


def explicit_topics(query: str) -> list[str]:
    careers = career_topics(query)
    topics = [key for key, pattern in TOPIC_PATTERNS.items() if matches(pattern, query)]
    # Narrow terms take precedence over broader ones: EXANI belongs to admissions,
    # EGEL to graduation, institutional email to student resources, etc.
    if "graduation" in topics and "admissions" in topics and "exani" not in query:
        topics.remove("admissions")
    if "student_resources" in topics and "contact" in topics and "correo" in query:
        topics.remove("contact")
    if "calendar" in topics and "contact" in topics and "horario de atencion" in query:
        topics.remove("calendar")
    if "calendar" in topics and "admissions" in topics and matches(r"\b(exani|admision|ingreso)\b", query):
        topics.remove("calendar")
    if "admissions" in topics and any(topic in topics for topic in (
        "scholarships", "social_service", "professional_practice", "mobility", "postgraduate", "school_services"
    )) and not matches(r"\b(admision|nuevo ingreso|exani|licenciatura)\b", query):
        topics.remove("admissions")
    if careers and "careers" in topics:
        topics.remove("careers")
    if "postgraduate" in topics and "careers" in topics:
        topics.remove("careers")
    if "professional_practice" in topics or "social_service" in topics:
        topics = [topic for topic in topics if topic != "school_services"]
    if "professional_practice" in topics and "facilities" in topics and "profesional" not in query:
        topics.remove("professional_practice")

    # Vocational queries may use interests rather than the exact degree name.
    if matches(r"\b(estudiar|carrera|carreras|me gusta|me interesa|quiero dedicarme|trabajar con)\b", query):
        if matches(r"\b(programacion|programar|software|computadoras|ciberseguridad|inteligencia artificial|datos)\b", query):
            careers.extend(["ici", "data_ai"])
        if matches(r"\b(robots?|robotica|automatizacion)\b", query):
            careers.append("mechatronics")
        if matches(r"\b(electricidad|energia|motores|maquinas)\b", query):
            careers.append("mechanical_electrical")
        if matches(r"\b(electronica|redes|comunicaciones)\b", query):
            careers.append("electronics_telecommunications")
        if careers:
            topics = [topic for topic in topics if topic != "careers"]

    if not careers and not topics and matches(INSTITUTION_PATTERN, query):
        clean = query.strip(" ?!¿¡.,")
        if matches(OVERVIEW_PATTERN, query) or clean in {"fime", "la fime", "facultad", "universidad de colima"}:
            return ["institution"]
    return list(dict.fromkeys(topics + careers))


def previous_topics(history: list[str]) -> list[str]:
    for previous in reversed(history):
        query = normalize(previous)
        if rejected(query):
            return []
        topics = explicit_topics(query)
        if topics:
            return topics
        if not matches(FOLLOWUP_PATTERN, query):
            return []
    return []


def answer_question(question: str, history: list[str], knowledge: KnowledgeBase) -> Answer:
    query = normalize(question)
    if rejected(query):
        return Answer(SCOPE_MESSAGE, [], [])
    safe_history = history if not history or not rejected(normalize(history[-1])) else []
    staff_answer = answer_people(question, safe_history, knowledge.people)
    if staff_answer is not None:
        return Answer(staff_answer.content, staff_answer.topics, staff_answer.sources)
    # Only standalone social exchanges bypass topical routing.
    social = query.strip(" ?!¿¡.,")
    if social in {"hola", "buenas", "buenos dias", "buenas tardes", "buenas noches", "hey", "hello", "ayuda", "que puedes hacer"}:
        return Answer("¡Hola! Soy FimeBot, la guía informativa de la **FIME · Universidad de Colima**. "
                      "Puedo ayudarte con carreras, admisión, becas, trámites y ubicación. "
                      "¿Qué te gustaría conocer?", [], [])
    if social in {"gracias", "muchas gracias", "ok", "vale", "perfecto", "adios", "hasta luego"}:
        return Answer("Con gusto. Aquí puedes consultar información de la FIME cuando la necesites.", [], [])

    topics = explicit_topics(query)
    if not topics and matches(FOLLOWUP_PATTERN, query):
        topics = previous_topics(history)
        if not topics:
            return Answer("¿Sobre qué carrera o trámite de la FIME necesitas ese dato? "
                          "Puedes escribir, por ejemplo, «¿Cuánto dura Mecatrónica?».", [], [])
    if not topics:
        if matches(INSTITUTION_PATTERN, query):
            return Answer(UNKNOWN_MESSAGE, [], [{"title": "Portal oficial de la FIME", "url": "https://portal.ucol.mx/fime/"}])
        return Answer(SCOPE_MESSAGE, [], [])

    # A generic listing is more readable than concatenating every degree profile.
    if len([topic for topic in topics if topic in CAREER_PATTERNS]) > 3:
        topics = [topic for topic in topics if topic not in CAREER_PATTERNS] + ["careers"]
    selected = [knowledge.entries[topic] for topic in topics if topic in knowledge.entries][:3]
    if not selected:
        return Answer(UNKNOWN_MESSAGE, [], [{"title": "Portal oficial de la FIME", "url": "https://portal.ucol.mx/fime/"}])

    sources = []
    seen_urls = set()
    sections = []
    for entry in selected:
        sections.append(f"**{entry.title}**\n\n{entry.text}")
        if entry.id == "location":
            sections.append("[Abrir el mapa interactivo del campus](/mapa)")
        entry_links = []
        for source in entry.sources:
            entry_links.append(f"[{source['title']}]({source['url']})")
            if source["url"] not in seen_urls:
                sources.append(source)
                seen_urls.add(source["url"])
        sections.append("Fuentes oficiales: " + " · ".join(entry_links))
    content = "\n\n".join(sections)
    return Answer(content, [entry.id for entry in selected], sources)

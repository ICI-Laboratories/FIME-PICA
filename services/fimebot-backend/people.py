"""Queries over the faculty's published staff roster, without generated facts."""

import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit


def normalized(text):
    text = unicodedata.normalize("NFKD", text.casefold())
    return " ".join("".join(c for c in text if not unicodedata.combining(c)).split())


def tokens(text):
    return set(re.findall(r"[a-z0-9]+", normalized(text))) - {
        "de", "del", "la", "las", "los", "el", "dr", "dra", "mtro", "mtra", "ing", "lic"
    }


@dataclass(frozen=True)
class PeopleAnswer:
    content: str
    topics: list[str]
    sources: list[dict]


@dataclass(frozen=True)
class PeopleDirectory:
    people: tuple[dict, ...]
    verified_on: str
    sources: tuple[dict, ...]

    @classmethod
    def load(cls, path: Path):
        data = json.loads(path.read_text(encoding="utf-8"))
        people = data["people"]
        if not people:
            raise ValueError("The staff directory must not be empty")
        ids = set()
        for person in people:
            if not re.fullmatch(r"[a-z][a-z0-9_-]*", person["id"]) or person["id"] in ids:
                raise ValueError("Invalid or duplicate person id")
            ids.add(person["id"])
            if not person["name"].strip() or not person["sources"]:
                raise ValueError("Staff require a name and official source")
            if person.get("category") not in {"full_time", "hourly", None}:
                raise ValueError("Invalid staff category")
            if person.get("email") and not person["email"].endswith("@ucol.mx"):
                raise ValueError("Only published institutional email is supported")
        for source in list(data["sources"]) + [s for person in people for s in person["sources"]]:
            url = urlsplit(source["url"])
            if (url.scheme != "https" or url.username or url.password or not source["title"].strip()
                    or not (url.hostname == "ucol.mx" or (url.hostname or "").endswith(".ucol.mx"))):
                raise ValueError("Staff sources must be official UCOL HTTPS pages")
        return cls(tuple(people), data["verified_on"], tuple(data["sources"]))

    def named(self, query):
        query_tokens = tokens(query)
        scored = []
        for person in self.people:
            names = [person["name"], *person.get("aliases", [])]
            score = max(len(tokens(name) & query_tokens) for name in names)
            if score:
                scored.append((score, person))
        if not scored:
            return []
        best = max(score for score, _ in scored)
        return [person for score, person in scored if score == best]


TEACHER_QUERY = r"\b(docentes?|profesor(?:es)?|profesoras?|maestros?|maestras?|doctores|doctoras|plantilla|plantel docente|ptc|por horas)\b"
PERSON_QUERY = r"\b(quien|quienes|grado|nombre|correo|email|contacto|cargo|formacion|estudios|estudio|doctorado|maestria|licenciatura|especialidad|hablame|cuentame|informacion|saber)\b"
FOLLOWUP = r"^[¿¡\s]*(?:y\s+)?(?:su (?:grado|correo|nombre|cargo|formacion)|que (?:grado|estudios) tiene|cual es su (?:grado|correo|nombre|cargo)|como (?:lo|la) contacto)(?: academico)?[?!¿¡.,\s]*$"
NAME_QUESTION_WORDS = tokens(
    "que quien quienes cual como cuanto es son tiene tienen su sus un una y o "
    "profesor profesora profesores profesoras maestro maestra maestros maestras docente docentes "
    "grado grados academico academica publicado publica nombre completo correo email institucional "
    "contacto cargo formacion estudios estudio curso obtuvo maestria doctorado licenciatura especialidad "
    "dime dame sabes conoces informacion sobre acerca fime facultad universidad colima ucol "
    "en donde trabaja labora imparte ensena investiga telefono llamar contactar del por favor "
    "doctor doctora licenciado licenciada ingeniero ingeniera cursado cursa hizo obtuvo tiene nivel "
    "hablame cuentame explica saber necesito quiero puedes podria podrias conocer da detalles detalle "
    "numero al con puedo hablar titulo titulos"
)
UNKNOWN_PERSON = "No tengo información verificada de esa persona en el listado consultado. Escribe su nombre completo o cargo; su ausencia aquí no confirma que no trabaje en FIME."
PRIVATE_FIELDS = r"\b(domicilio|casa|celular|personal|edad|sueldo|salario|rfc|curp|cedula profesional|contrasena|password|secreto)\b"


def degree_label(person):
    degree = person.get("degree")
    return degree if degree else "Grado no publicado en las fuentes consultadas"


def administrative_roles(person):
    return [role for role in person.get("roles", []) if not normalized(role).startswith("docente ")]


def result(directory, selected, title, *, listing=False, notice="", ambiguous=False):
    sources = []
    seen = set()
    for person in selected:
        for source in person["sources"]:
            if source["url"] not in seen:
                sources.append(source)
                seen.add(source["url"])
    if not sources:
        sources = list(directory.sources)
    sections = [title]
    if notice:
        sections.append(notice)
    if listing or ambiguous:
        for person in selected:
            roles = "; ".join(administrative_roles(person))
            suffix = f" · {roles}" if roles and "docentes de fime:" not in normalized(title) else ""
            sections.append(f"- **{person['name']}** — {degree_label(person)}{suffix}")
    else:
        for person in selected:
            sections.append(f"**{person['name']}**")
            if administrative_roles(person):
                sections.append("Cargo: " + "; ".join(administrative_roles(person)) + ".")
            sections.append("Grado académico publicado: **" + degree_label(person) + "**.")
            if person.get("degree_detail"):
                sections.append("Formación publicada: " + person["degree_detail"] + ".")
            category = {"full_time": "Profesor/a de tiempo completo", "hourly": "Profesor/a por horas"}.get(person.get("category"))
            if category:
                sections.append("Adscripción en el listado: " + category + ".")
            if person.get("email"):
                sections.append("Correo institucional: " + person["email"])
            if person.get("phone"):
                phone = person["phone"]
                if person.get("extension"):
                    phone += " · extensión " + str(person["extension"])
                sections.append("Teléfono: " + phone)
    sections.append("Fuentes oficiales: " + " · ".join(f"[{s['title']}]({s['url']})" for s in sources))
    sections.append("Consulta de fuentes: " + directory.verified_on + ".")
    return PeopleAnswer("\n\n".join(sections), ["faculty_people"] + ["person_" + p["id"] for p in selected], sources)


def role_selection(query, directory):
    if re.search(r"\b(director|directora|dirige|a cargo de (?:la )?fime)\b", query):
        return [p for p in directory.people if any(normalized(role) == "director" for role in p["roles"])], "**Dirección de FIME**"
    if re.search(r"\b(secretaria|secretario)\b", query):
        return [p for p in directory.people if any("administrativa" in normalized(role) for role in p["roles"])], "**Secretaría Administrativa**"
    if re.search(r"\b(asesor|asesora|asesores|asesoria)\b.*\b(pedagogic[ao]s?)\b", query):
        return [p for p in directory.people if any("pedagogic" in normalized(role) for role in p["roles"])], "**Asesoría pedagógica**"
    if re.search(r"\b(coordinador[ae]?s?|coordinadora|coordinacion|coordina|coordinan)\b", query):
        coordinators = [p for p in directory.people if any(re.search(r"coord", normalized(role)) for role in p["roles"])]
        scopes = [
            (r"\b(ici|computacion inteligente)\b", "computacion"),
            (r"\b(ime|mecanico electricista)\b", "mecanico"),
            (r"\b(im|mecatronica)\b", "mecatronica"),
            (r"\b(iset|sistemas electronicos|telecomunicaciones)\b", "sistemas electronicos"),
            (r"\b(mia|ingenieria aplicada)\b", "aplicada"),
            (r"\b(mip|ingenieria de procesos)\b", "procesos"),
            (r"\b(academico|academica)\b", "academico"),
        ]
        matched = [key for pattern, key in scopes if re.search(pattern, query)]
        if matched:
            return [p for p in coordinators if any(key in normalized(role) for key in matched for role in p["roles"])], "**Coordinación de FIME**"
        if re.search(r"\b(datos|inteligencia artificial|idia)\b", query):
            return [], "No hay una coordinación de Datos e IA identificada en el directorio consultado."
        return coordinators, "**Coordinaciones de FIME**"
    return None


def answer_people(question, history, directory):
    if directory is None:
        return None
    query = normalized(question)
    if re.fullmatch(FOLLOWUP, query):
        # User questions select context. Client-supplied assistant prose is never read.
        for previous in reversed(history):
            if re.fullmatch(FOLLOWUP, normalized(previous)):
                continue
            prior = answer_people(previous, [], directory)
            if prior:
                ids = {topic.removeprefix("person_") for topic in prior.topics if topic.startswith("person_")}
                selected = [p for p in directory.people if p["id"] in ids]
                if len(selected) == 1:
                    return result(directory, selected, "**Información publicada**")
            break
        return result(directory, [], "¿De qué docente o autoridad necesitas el grado, correo o cargo? Escribe su nombre o puesto.")

    role = role_selection(query, directory)
    candidates = directory.named(query)
    if role or candidates or re.search(TEACHER_QUERY, query):
        if re.search(r"\b(telematica|medicina|derecho|uanl|unam|otra facultad)\b", query):
            return result(directory, [], "Este directorio corresponde a la FIME de la Universidad de Colima. No tengo verificado el personal de esa otra institución o facultad.")
        if re.search(PRIVATE_FIELDS, query):
            return result(directory, [], "Solo puedo compartir los datos profesionales publicados por FIME: nombre, grado, cargo y correo institucional.")
    if role:
        if re.search(r"\b(quien fue|exdirector|exdirectora|anterior|antes|en (?:19|20)\d{2})\b", query):
            return result(directory, [], "No tengo verificado el historial de ese cargo. La fuente consultada publica el directorio actual, sin identificar quién lo ocupaba en el periodo solicitado.")
        selected, title = role
        return result(directory, selected, title, listing=len(selected) > 3)

    teacher_intent = bool(re.search(TEACHER_QUERY, query))
    # Names may be written in either order, with or without accents. A single
    # common given name is deliberately ambiguous rather than guessing a person.
    if candidates:
        best_tokens = max(len(tokens(p["name"]) & tokens(query)) for p in candidates)
        if teacher_intent or re.search(PERSON_QUERY, query) or best_tokens >= 2 or tokens(query) <= set().union(*(tokens(p["name"]) for p in candidates)):
            known_name_tokens = set().union(*(tokens(p["name"]) for p in candidates))
            if tokens(query) - known_name_tokens - NAME_QUESTION_WORDS:
                return result(directory, [], UNKNOWN_PERSON)
            if len(candidates) > 1:
                return result(directory, candidates, "Encontré varias personas. ¿Cuál buscas? Indica su nombre y apellido.", listing=True, ambiguous=True)
            person = candidates[0]
            if re.search(r"\b(en que|de que|especialidad|area|universidad|donde)\b.*\b(doctorado|maestria|estudio|estudios|titulo)\b|\b(doctorado|maestria) en\b", query):
                notice = "" if person.get("degree_detail") else "La fuente publica el nivel académico; no especifica aquí la disciplina ni la institución que otorgó el grado."
                return result(directory, [person], "**Formación publicada**", notice=notice)
            return result(directory, [person], "**Docentes y autoridades de FIME**")

    if teacher_intent:
        teachers = [p for p in directory.people if p.get("category") in {"full_time", "hourly"}]
        filtered = teachers
        if re.search(r"\b(tiempo completo|ptc)\b", query):
            filtered = [p for p in filtered if p["category"] == "full_time"]
        elif re.search(r"\b(por horas|hora clase)\b", query):
            filtered = [p for p in filtered if p["category"] == "hourly"]
        for pattern, degree in [(r"doctorados?|doctores|doctoras", "doctorado"), (r"maestria", "maestria"), (r"licenciatura", "licenciatura"), (r"especialidad", "especialidad")]:
            if re.search(r"\b(?:" + pattern + r")\b", query):
                filtered = [p for p in filtered if normalized(p.get("degree") or "") == degree]
        # A question about a named but absent person must not dump the full roster.
        if re.search(r"\b(quien es|quien fue|conoces|sabes de|que grado tiene|grado de|correo de)\b", query) and not re.search(r"\b(todos|lista|listado|directorio)\b", query):
            return result(directory, [], UNKNOWN_PERSON)
        notice = "Se incluyen los docentes publicados por FIME; la fuente indica el nivel del grado, sin detallar su especialidad."
        if re.search(r"\b(ici|ime|im|iset|mecatronica|computacion|materia|imparte|ensenan|dan clases)\b", query):
            notice = "El listado oficial no detalla las asignaturas ni la carrera de adscripción de cada docente. Estos son los docentes publicados por FIME."
        return result(directory, filtered, f"**Docentes de FIME: {len(filtered)} personas**", listing=True, notice=notice)

    if re.search(r"\b(autoridades|directorio|equipo directivo)\b", query):
        selected = [p for p in directory.people if administrative_roles(p)]
        return result(directory, selected, "**Directorio de autoridades y coordinaciones de FIME**", listing=True)
    if re.search(r"\b(correo|contacto) (?:de |del )?(?:la )?(?:fime|facultad|universidad de colima)\b", query):
        return None
    if re.search(r"\b(quien es|quien fue|grado (?:de|tiene)|correo de)\b", query):
        return result(directory, [], UNKNOWN_PERSON)
    return None

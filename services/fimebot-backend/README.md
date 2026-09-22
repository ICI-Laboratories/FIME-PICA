# FimeBot: información verificada de la FIME

El servicio responde con `context/knowledge.json` y `context/people.json`, que contienen información y enlaces oficiales de la Universidad de Colima. Los datos concretos salen directamente de esas fichas. Una capa opcional con `qwen-local`, alojado en el servidor, ayuda a comparar carreras según los intereses del visitante, sin API de pago.

`policy.py` identifica temas, permite comparar hasta tres perfiles de carrera y resuelve seguimientos breves como «¿y cuánto dura?» a partir de las preguntas anteriores. El contenido de mensajes `assistant` enviados por el cliente se ignora. Las preguntas desconocidas reciben orientación al portal del plantel. Los detectores de instrucciones mejoran el rechazo; las respuestas factuales se limitan a contenido revisado.

## Orientación híbrida

`hybrid.py` atiende consultas abiertas como «me gusta la robótica y programar páginas web, ¿qué carrera me conviene?» y comparaciones de carreras. Director, docentes, grados, fechas, duración, horarios, costos y trámites conservan la ruta determinista. No se intenta sustituir todas las preguntas desconocidas por inferencia.

El servidor extrae intereses de un vocabulario permitido y recupera hasta tres perfiles de `knowledge.json`. El modelo recibe esos datos estructurados; no recibe la pregunta original ni el historial del navegador. Qwen selecciona opciones, afinidades y evidencia del corpus. La respuesta debe ajustarse al esquema, las opciones y los fragmentos permitidos; el servidor agrega las fuentes oficiales y presenta la orientación con redacción controlada. Así se evita publicar prosa factual libre del modelo. La recomendación es orientativa y no garantiza aptitud, admisión ni empleo.

Hay un límite de dos inferencias simultáneas sin cola por proceso y un tiempo máximo total de 12 segundos. Un fallo de conexión, saturación, tiempo agotado o salida no válida devuelve las fichas verificadas; el chat sigue funcionando. La salida se valida completa antes de enviarla, también con SSE. Se solicita JSON Schema estricto al gateway y además se comprueban en el servidor las relaciones entre carrera, interés y evidencia.

Configuración: `FIMEBOT_HYBRID_ENABLED=true`, `OPENAI_BASE_URL`, `OPENAI_MODEL=qwen-local` y `OPENAI_API_KEY` (credencial del gateway privado). Docker Compose toma los últimos tres valores de `LLM_BASE_URL`, `LLM_MODEL` y `LLM_API_KEY` de `.env.production`, y conecta con la red externa `llm-apps`. El módulo está deshabilitado por defecto fuera de Compose. No se envían credenciales al cliente ni se registran preguntas o secretos. Una instalación sin gateway puede usar `FIMEBOT_HYBRID_ENABLED=false`.

## Actualizar la información

1. Consultar la página oficial vigente en un dominio `ucol.mx`.
2. Actualizar la ficha y sus fuentes en `context/knowledge.json`, con una fecha de verificación real. Los campos son `id`, `title`, `text`, `aliases`, `keywords`, `sources` y `verified_on`.
3. Si se añade un tema nuevo, registrar su intención en `TOPIC_PATTERNS` o `CAREER_PATTERNS`, dentro de `policy.py`. Los alias y las palabras clave del corpus documentan el contenido; **no autorizan respuestas automáticamente**.
4. Ejecutar las pruebas y reconstruir el contenedor. El corpus se valida al arrancar; las fuentes deben ser HTTPS de la Universidad de Colima.

Mantener advertencias claras en fichas con convocatorias, costos y requisitos variables. Una fecha de consulta no acredita que todos los datos sigan vigentes indefinidamente.

## Docentes, grados y autoridades

`context/people.json` contiene las 61 filas publicadas en el [listado docente de FIME](https://portal.ucol.mx/fime/docentes.htm): 21 de tiempo completo y 40 por horas, con nombre, grado, categoría, correo y fuentes. Se agregan las autoridades del [directorio oficial](https://portal.ucol.mx/fime/directorio.htm), deduplicadas con los docentes: 65 personas en total. Las cuatro personas que sólo figuran en el directorio no tienen grado publicado; se guarda `null` y se informa esa ausencia.

`people.py` resuelve cargos antes de las fichas genéricas, nombres con o sin acentos y en distinto orden, y seguimientos como «¿y su grado?». Una coincidencia ambigua solicita apellido; no se asigna un perfil cuando el apellido escrito no coincide. Se pueden pedir todos los docentes o filtrar por categoría y grado. La consulta de dirección devuelve nombre y grado publicados, en lugar de sólo enlazar al directorio.

Para actualizar, cotejar **todas** las filas de ambas fuentes, conservar variantes de nombres y correos en `aliases`/`emails`, actualizar `sources`, `verified_on` y los conteos de `coverage`, y ejecutar la suite. Cuando una publicación oficial fechada acredita un grado posterior al listado, conservar el valor literal del listado en `degree_published` y documentar la corrección, fecha y evidencia. Walter Alexander Mata López figura como Doctorado: noticia institucional del 23 de febrero de 2026 y semblanza PIFOD 2025; la tabla docente aún indica Maestría. No inferir especialización, institución otorgante, cédula, historial de cargos ni asignaturas. No se importan biografías o registros colectivos de la base de horarios como si fueran personas verificadas. El archivo es obligatorio al arrancar el servicio.

Ejemplos: «¿Quién es el director de la FIME?», «¿Qué grado tiene Walter?», «¿Quién coordina ICI?», «Lista de profesores por horas», «Docentes con doctorado».

## API y límites

- `GET /health`: estado, modo, número de fichas/personas y fechas de consulta; no expone infraestructura interna.
- `POST /api/chat`: conserva JSON `{message: {role, content}, done}` y streaming SSE con `choices[0].delta.content` seguido de `[DONE]`. Ambos incluyen `sources`, `topics` y `mode` (`verified-knowledge` o `hybrid-grounded`).
- Sólo roles `user` y `assistant`, alternados, comenzando y terminando en `user`. Máximo 13 mensajes, 1200 caracteres por pregunta, 10 000 por respuesta previa y 32 000 en todo el historial.
- Cuerpo HTTP máximo 65 536 bytes, comprobado antes de analizar JSON, incluso si falta o se falsifica `Content-Length`.
- Los errores de validación no reflejan el mensaje original ni los detalles internos. `think` se admite por compatibilidad; la ruta y el modelo los decide el servidor.
- El servicio se sirve detrás del proxy del sitio. El límite de solicitudes se aplica en Nginx; no se confía en cabeceras arbitrarias para identificar visitantes.

## Pruebas

```sh
python -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -v
```

Las pruebas cubren consultas admitidas, comparaciones, seguimientos, preguntas ajenas y mixtas, intentos de cambiar instrucciones, historial falsificado, límites de entrada, errores seguros y equivalencia SSE/JSON. La capa híbrida se prueba con un gateway simulado: selección de evidencia, rechazo de salidas inventadas, errores, tiempo agotado, cancelación y saturación. Las pruebas unitarias no requieren conexión a un modelo ni a las páginas fuente; antes de desplegar cambios de protocolo conviene comprobar también el gateway local real.

# FimeBot: información verificada de la FIME

El servicio responde únicamente con `context/knowledge.json`, que contiene información y enlaces oficiales de la Universidad de Colima. No usa modelos generativos, servicios externos, claves de API ni tokens de pago. Las consultas seleccionan fichas verificadas; nunca modifican su texto. Esto limita el alcance del asistente por diseño, además de rechazar consultas ajenas e instrucciones para cambiar su comportamiento.

`policy.py` identifica temas, permite comparar hasta tres perfiles de carrera y resuelve seguimientos breves como «¿y cuánto dura?» a partir de las preguntas anteriores. El contenido de mensajes `assistant` enviados por el cliente se ignora. Las preguntas desconocidas reciben orientación al portal del plantel; no se inventan respuestas, fechas ni datos personales. Los detectores de instrucciones mejoran la experiencia de rechazo, pero la protección principal es que solamente se puede devolver contenido revisado del corpus.

## Actualizar la información

1. Consultar la página oficial vigente en un dominio `ucol.mx`.
2. Actualizar la ficha y sus fuentes en `context/knowledge.json`, con una fecha de verificación real. Los campos son `id`, `title`, `text`, `aliases`, `keywords`, `sources` y `verified_on`.
3. Si se añade un tema nuevo, registrar su intención en `TOPIC_PATTERNS` o `CAREER_PATTERNS`, dentro de `policy.py`. Los alias y las palabras clave del corpus documentan el contenido; **no autorizan respuestas automáticamente**.
4. Ejecutar las pruebas y reconstruir el contenedor. El corpus se valida al arrancar; las fuentes deben ser HTTPS de la Universidad de Colima.

Mantener advertencias claras en fichas con convocatorias, costos y requisitos variables. Una fecha de consulta no acredita que todos los datos sigan vigentes indefinidamente.

## API y límites

- `GET /health`: estado, modo, número de fichas y fecha de verificación; no expone infraestructura interna.
- `POST /api/chat`: conserva JSON `{message: {role, content}, done}` y streaming SSE con `choices[0].delta.content` seguido de `[DONE]`. Ambos incluyen `sources` y `topics`; JSON también incluye `mode`.
- Sólo roles `user` y `assistant`, alternados, comenzando y terminando en `user`. Máximo 13 mensajes, 1200 caracteres por pregunta, 10 000 por respuesta previa y 32 000 en todo el historial.
- Cuerpo HTTP máximo 65 536 bytes, comprobado antes de analizar JSON, incluso si falta o se falsifica `Content-Length`.
- Los errores de validación no reflejan el mensaje original ni los detalles internos. `think` se admite por compatibilidad y no activa ningún modelo.
- El servicio se sirve detrás del proxy del sitio. El límite de solicitudes se aplica en Nginx; no se confía en cabeceras arbitrarias para identificar visitantes.

## Pruebas

```sh
python -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -v
```

Las pruebas cubren consultas admitidas, comparaciones, seguimientos, preguntas ajenas y mixtas, intentos de cambiar instrucciones, historial falsificado, límites de entrada, errores seguros y equivalencia SSE/JSON. No requieren conexión a un modelo ni a las páginas fuente.

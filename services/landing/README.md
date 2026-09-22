# Landing FIME

Portal estático de FIME, Universidad de Colima, con FimeBot y enlaces a StudentHUB.

## FimeBot

La fuente de respuestas está en `../fimebot-backend/context/knowledge.json`.
El backend responde con información revisada y enlaces oficiales; no requiere un
modelo, servicios de IA externos ni API keys. No usar el antiguo contexto de texto
como fuente: fue sustituido por la base con referencias y fecha de revisión.

El chat ofrece consultas rápidas, conserva hasta seis intercambios en memoria
mientras la página está abierta y recibe respuestas mediante SSE. El texto se
renderiza con nodos DOM (sin ejecutar HTML); los enlaces se limitan a UCOL y rutas
locales. Los errores del servidor no se muestran al visitante.

## Archivos

- `index.html`: portal, carrusel y chat.
- `css/`: estilos adaptables a escritorio y móvil.
- `js/chatbot.js`: conversación, SSE y formato seguro de respuestas.
- `img/`: fotografías existentes.
- `nginx.conf` y `Dockerfile`: publicación estática.

Vista local de la interfaz (sin API):

```bash
python3 -m http.server 1356 --bind 127.0.0.1 --directory services/landing
```

Para probar respuestas usar el despliegue Docker con el proxy `/api/chat`.

## Pruebas del chat

Con Node.js 22.12 o posterior, desde la raíz del repositorio:

```bash
npm ci --prefix services/landing
npm test --prefix services/landing
```

Las siete pruebas de `tests/chat-client.test.mjs` usan un DOM aislado y respuestas
simuladas: no contactan al sitio publicado ni a servicios externos. Verifican HTML
y enlaces seguros, el historial de conversaciones largas, el bloqueo de envíos
simultáneos, la recuperación tras fallos de red, límites 429, timeout, SSE con UTF-8
fragmentado y el rechazo de las APIs de escritura del mapa. Las dependencias son
solo de desarrollo; la imagen Docker sigue sirviendo archivos estáticos.

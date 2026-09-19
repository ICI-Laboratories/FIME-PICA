# Landing Service (FimeBot Landing)

Sitio estático HTML/CSS/JavaScript importado y adaptado para FimeBot en el monorepo `FIME-PICA`.
Contiene la interfaz de presentación institucional de la facultad, el carrusel de actividades y el componente visual interactivo del bot.

## Contexto Institucional del Bot
- `context/base_context.txt`: Base de conocimiento integral de toda la facultad (FIME - Universidad de Colima en Campus Coquimatlán), incluyendo historia, oferta educativa (ICI, Mecatrónica, IME, Sistemas Electrónicos, posgrados), autoridades, laboratorios (Isaac, Brenda, Meca), servicios estudiantiles (SICEUC, becas SIBEUCOL) y transporte.

## Estructura de Archivos
- `index.html`: Estructura principal con carrusel institucional, menú de navegación y widget flotante de chat.
- `css/`: Hojas de estilo para la interfaz, encabezados y chatbox.
- `js/`: Lógica para el carrusel y comunicación con la API del bot (`chatbot.js`).
- `img/`: Activos visuales y fotografías de la institución.
- `context/`: Base de conocimiento institucional para el modelo de lenguaje.
- `nginx.conf` y `Dockerfile`: Configuración para servir como contenedor independiente o mapear a través del proxy de FIME-PICA.

## Previsualización local rápida
```bash
python3 -m http.server 1356 --directory services/landing
```

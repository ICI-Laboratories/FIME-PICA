Aquí tienes un **master prompt** diseñado para que se lo entregues a tu agente de desarrollo (sea un asistente, un programador o una IA generadora de código). Incluye todos los requisitos, restricciones y el contexto técnico que hemos definido.

---

# MASTER PROMPT PARA AGENTE DE DESARROLLO

## 1. Contexto general

Vas a desarrollar una **aplicación web estática** que muestre perfiles académicos de profesores a estudiantes, con un enfoque **inspiracional y formal institucional**.  
Los datos residen en **archivos JSON** (un archivo por docente) y el sitio se genera estáticamente con **Astro**. El diseño debe ser **original, sin clichés de IA generativa** (nada de gradientes, glassmorphism, neones, fuentes genéricas como Inter/Poppins).  
Se busca velocidad extrema, coste cero (hosting en Netlify/Vercel) y facilidad para añadir o editar docentes mediante edición directa de JSON o futura integración con CMS.

## 2. Requisitos funcionales

- **Listado de docentes**: Página `/docentes` que muestre una cuadrícula (o lista formal) con foto, nombre, departamento y un resumen breve (áreas de especialización inferidas).
- **Perfil individual**: Página `/docentes/[slug]` con la información completa del docente según el esquema JSON.
- **Estructura de perfil** (inspiracional):
  - Tarjeta de identidad (foto B/N o sepia, nombre, título, antigüedad, correo institucional).
  - Secciones: *Formación académica*, *Publicaciones recientes*, *Libros*, *Material didáctico*, *Cursos impartidos*, *Tesis dirigidas*, *Certificaciones destacadas*.
  - Barra lateral de logros (años de servicio, artículos JCR, tesis dirigidas, nivel de cuerpo académico).
  - Frase destacada del docente (extraída de sus conferencias o publicaciones si existe).
- **No mostrar** bajo ningún concepto: número de empleado, código de evaluación interna (I.I.3, etc.), direcciones personales, estados “En trámite”, horas de gestión administrativa.

## 3. Requisitos técnicos obligatorios

### 3.1 Stack
- **Framework**: Astro (modo `static`).
- **Estilos**: Tailwind CSS con **configuración personalizada** (no usar temas por defecto).
- **Datos**: Archivos JSON en `src/content/profesores/*.json`. Cada JSON sigue el esquema proporcionado (basado en el ejemplo de `cv_extracted.json` pero limpiado de campos irrelevantes).
- **Hosting**: Netlify o Vercel (preparar configuración para despliegue continuo desde Git).

### 3.2 Estructura de proyecto esperada
```
src/
├── content/
│   └── profesores/
│       ├── walter-mata.json
│       └── (más archivos .json)
├── layouts/
│   └── InstitutionalLayout.astro   (grid asimétrico, metadatos, tipografías globales)
├── pages/
│   ├── docentes.astro               (listado)
│   └── docentes/
│       └── [slug].astro             (perfil individual)
├── components/
│   ├── IdentityCard.astro
│   ├── PublicationList.astro
│   ├── TeachingList.astro
│   ├── ImpactSidebar.astro
│   └── TeacherGrid.astro
├── lib/
│   └── cargarProfesores.js          (función que lee todos los JSON y devuelve array con slug)
└── styles/
    └── global.css                   (reset, estilos base de tipografía y líneas)
```

### 3.3 Configuración de Tailwind (personalizada)
- Colores exclusivos:
  - Fondo: `#F9F8F6` (papel)
  - Secundario: `#EEEDEB` (piedra)
  - Texto principal: `#13294B` (azul marino)
  - Acento logros: `#9E7B4B` (ocre mate)
  - Acento acciones/enlaces: `#527630` (verde)
  - Líneas: `#D1D5DB`
- Tipografías:
  - Nombres y títulos principales: `Cormorant Garamond` (serif, semibold)
  - Encabezados de sección: `Source Serif 4` (semibold, mayúsculas suaves)
  - Texto general: `Public Sans`
  - Citas y datos técnicos (números de estudiantes, años): `JetBrains Mono` (pequeñas dosis)
- Deshabilitar: prefijo `group`, `focus:`, `active:` no necesarios. No usar `@apply` en exceso.
- Archivo `tailwind.config.js` debe extender `theme` con las claves anteriores.

### 3.4 Esquema JSON normalizado (por docente)

Basado en el JSON proporcionado, crear un único archivo por docente con esta estructura limpia (solo campos útiles para el estudiante). Ejemplo parcial:

```json
{
  "slug": "walter-mata",
  "fullName": "Walter Alexander Mata López",
  "photoUrl": "/images/profesores/walter-mata.jpg",   (opcional)
  "title": "Profesor Investigador de Tiempo Completo",
  "department": "Facultad de Ingeniería Mecánica y Eléctrica",
  "institutionalEmail": "wmata@ucol.mx",
  "admissionYear": 1997,
  "quote": "Del aula tradicional al aula inteligente con IA Generativa",
  "academicFormation": {
    "doctorados": [
      { "degree": "Doctor en Tecnología Educativa", "institution": "Centro Universitario Mar de Cortés", "year": 2025 }
    ],
    "maestrias": [...],
    "licenciatura": {...}
  },
  "scientificProduction": {
    "articles": [ { "title": "...", "journal": "...", "year": 2025, "impactFactor": 3.6, "doi": "..." } ],
    "books": [ { "title": "...", "role": "Coordinador", "editorial": "...", "year": 2025 } ]
  },
  "educationalMaterials": [ { "title": "...", "type": "Recurso digital", "year": 2025, "url": "..." } ],
  "teaching": {
    "courses": [ { "name": "...", "level": "Licenciatura", "students": 55, "period": "Ago-Ene 2025" } ],
    "theses": [ { "student": "...", "title": "...", "year": 2025, "role": "Asesor" } ]
  },
  "certifications": [ { "title": "...", "institution": "...", "year": 2025 } ],
  "academicBody": { "name": "Automatización y Sistemas", "level": "CAEC" }
}
```

> **Importante**: filtrar todo campo `evaluationCode`, `employeeNumber`, `status` = "En trámite", `weeklyHours` de gestión, etc. Solo datos inspiracionales.

### 3.5 Requisitos de diseño visual (no negociables)
- **Grid asimétrico** en escritorio: 30% columna izquierda (identidad), 50% central (contenido principal), 20% derecha (logros). En móvil: se pliega a una columna.
- **Sin bordes redondeados excesivos** (máx 4px). Esquinas rectas o muy ligeramente redondeadas.
- **Separadores**: líneas horizontales finas `1px` color `#D1D5DB`.
- **Listas**: usar viñetas cuadradas `■` (color ocre) en lugar de círculos.
- **Badges de impacto**: formato texto sin fondo, con símbolo `†` o `§`. Ej: `† Factor de impacto 3.6`.
- **Tarjeta de curso**: tabla simple sin bordes verticales, solo líneas horizontales.
- **Enlaces**: subrayado discontinuo o borde inferior delgado al hacer hover, color verde `#527630`.
- **Interacción mínima**: hover solo cambia color de texto o borde, sin escalas ni animaciones complejas.

### 3.6 Rendimiento y accesibilidad
- Todas las páginas deben pasar Lighthouse >95 en rendimiento, accesibilidad y mejores prácticas.
- Las imágenes (fotos) deben tener lazy loading y formato WebP si es posible.
- HTML semántico (main, section, article, aside).
- Contraste de color verificado (fondo blanco roto vs azul marino cumple WCAG AA).

### 3.7 Despliegue y mantenimiento
- Incluir scripts en `package.json` para `astro build`.
- Configurar `netlify.toml` o `vercel.json` para que la ruta `/docentes/[...]` funcione correctamente.
- Documentar en `README.md` cómo añadir un nuevo docente (crear JSON y foto).

## 4. Restricciones anti-patrón (lo que NO debe hacerse)

- [X] No usar fuentes comunes de IA (Poppins, Inter, Montserrat, Roboto, Nunito).
- [X] No usar gradientes, fondos borrosos, sombras grandes, glassmorphism.
- [X] No usar íconos de paquete estándar (FontAwesome, Heroicons) – usar caracteres tipográficos (■, †, ✦, →) o si realmente se necesita, iconos minimalistas de trazo simple.
- [X] No mostrar ningún dato administrativo o código de evaluación.
- [X] No mostrar barras de progreso, gráficas circulares, efectos “modernos”.
- [X] No generar estilos responsivos que rompan el grid asimétrico (en móvil simplemente apilar).
- [X] No implementar autenticación, base de datos externa, formularios o comentarios.

## 5. Entregables esperados

El agente debe proporcionar:

1. **El código completo del proyecto** (estructura de archivos, contenido de cada archivo).
2. **Un archivo JSON de ejemplo** para al menos dos docentes (usando el dado como base y otro inventado pero coherente).
3. **Instrucciones claras** para:
   - Instalar dependencias (`npm install`).
   - Ejecutar en desarrollo (`npm run dev`).
   - Construir para producción (`npm run build`).
   - Desplegar en Netlify/Vercel.
4. **Capturas de wireframes** (opcional, pero bienvenido si es posible) que muestren el diseño final acorde a las especificaciones.

## 6. Nota adicional para el agente

> El diseño debe **transmitir formalidad académica y respeto**. Piensa en una revista científica de alto prestigio o un anuario universitario de los años 60. La tipografía y el espacio en blanco son tan importantes como los datos. Cada elemento debe parecer deliberado, no una plantilla genérica.

---

## 7. Criterios de aceptación

- [ ] El listado de docentes muestra al menos 2 profesores.
- [ ] La página individual del Dr. Walter Mata coincide con los datos JSON proporcionados.
- [ ] No aparece ningún código `I.II.X` ni “En trámite”.
- [ ] En escritorio, el grid es asimétrico 30/50/20.
- [ ] Las tipografías son exactamente las especificadas.
- [ ] Los colores coinciden con la paleta (azul marino, ocre, verde, fondo papel).
- [ ] El hover sobre publicaciones cambia a verde sin efectos extra.
- [ ] El build produce HTML estático (verificar `dist/`).
- [ ] El sitio funciona sin JavaScript (progressive enhancement).

---

Si el agente cumple con todos estos puntos, tendrás una aplicación profesional, ultrarrápida, económica y con un diseño único que inspirará a los estudiantes.

**¡Adelante con el desarrollo!**
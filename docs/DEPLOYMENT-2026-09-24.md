# FIME-PICA: restauración del uso original — 24 de septiembre de 2026

## Estado vigente

Se revirtió el reemplazo visual y funcional del sitio a petición del usuario. FIME-PICA es una aplicación compartida y debe conservar su identidad, navegación y acceso rápido. No convertirla en un portal centrado en login ni retirar funciones públicas.

- `/`: landing original FIMEBot, con su diseño y orientación institucional.
- `/studenthub`: selección pública de carrera, semestre y grupo; horario semanal sin cuenta.
- `/mapa`: mapa interactivo y buscador de espacios, sin cuenta.
- `/profesores`, `/materias`, `/fechas`: consultas académicas públicas originales.
- `/aplicaciones`: apartado adicional con el estilo de InstitutionalLayout, búsqueda y enlaces a SARA, SARA Pad, SmartDoc y FimeBot. No reemplaza la portada ni Student Hub.
- `/session/*`: acceso central opcional mediante el BFF y SARA Identity; no condiciona las consultas anteriores. El emisor local de credenciales no se ejecuta; sus rutas públicas permanecen deshabilitadas.

Se restauraron el código original y los volúmenes existentes. La base activa contiene 86 profesores, 34 grupos y 700 filas de horarios. Se conservan los respaldos privados en `/home/peter/backups/fime-central-20260924/`; no fue necesario importar ni reconstruir los datos.

## Validación

Build de Astro, landing, proxy y FimeBot completado. En navegador, sin cuenta autenticada, se verificaron selección de carrera → semestre → grupo → horario completo, mapa cargado y directorio de docentes del grupo. El catálogo usa la misma navegación y apariencia institucional. Se corrigieron enlaces de «Horario» y «Cambiar grupo» que apuntaban a la raíz en vez de `/studenthub`.

La integración central conserva cliente `student-hub-web`, audiencia `student-hub` y callback `https://fime.ici-labs.com/session/callback`. El login no es una barrera para la información pública. La sesión con una cuenta real sigue sin probarse; no se crearon cuentas de prueba.

## Fuera de alcance

AgentAgenda, Immich y Jellyfin son aplicaciones personales separadas. No forman parte de esta integración ni del catálogo estudiantil; no hay una migración pendiente de ellas dentro de este trabajo.

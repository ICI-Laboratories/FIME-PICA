# Herramientas para estudiantes — inventario del 24 de septiembre de 2026

Se revisaron los repositorios locales, el inventario Docker de `cite-server` por
SSH y las páginas públicas mediante solicitudes HTTP sin iniciar sesión.
Responder HTTP 200 comprueba que la página está publicada; no certifica los
flujos autenticados ni todos los servicios internos de una aplicación.

## Publicadas y pertinentes para el catálogo

| Herramienta | Enlace | Acceso y evidencia |
| --- | --- | --- |
| Student Hub | https://fime.ici-labs.com/studenthub | Público; HTTP 200. Selección de carrera, semestre y grupo para consultar el horario. |
| Mapa del campus | https://fime.ici-labs.com/mapa | Público; HTTP 200. Buscador de espacios y mapa de la facultad. |
| Directorio de profesores | https://fime.ici-labs.com/profesores | Público; HTTP 200. |
| Materias | https://fime.ici-labs.com/materias | Público; HTTP 200. Puede mantenerse como acceso rápido de Student Hub. |
| Fechas y evaluaciones | https://fime.ici-labs.com/fechas | Público; HTTP 200. Puede mantenerse como acceso rápido de Student Hub. |
| SARA | https://sara.ici-labs.com | HTTP 200; título «SARA · Plataforma Académica». Servicio activo en `cite-server`; cuenta SARA. |
| SARA Pad | https://sarapad.ici-labs.com | HTTP 200; frontend y servicios activos en `cite-server`; cuenta SARA. |
| SARA DocReader | https://saradoc.ici-labs.com | HTTP 200; título «SARA DocReader · Biblioteca documental». Acceso temporal sin cuenta y cuenta SARA. |
| FimeBot | https://fime.ici-labs.com/#fimebot-chat | Asistente integrado en la portada pública; el fragmento coincide con el `id` del elemento en `services/landing/index.html`. |

Student Hub, mapa y directorio son herramientas de la propia FIME, no despliegues
independientes. Conviene identificarlos como recursos del campus dentro del
catálogo y mantener el acceso directo habitual desde el menú.

`SmartDoc` es el nombre del repositorio de SARA DocReader y debe conservarse como
alias para búsqueda. El endpoint público `GET /session/me` respondió sin cuenta:
`mode: "choose"`, `login_available: true`, `ephemeral_hours: 24`. Por ello la ficha
no debe indicar que una cuenta es obligatoria. La documentación local antigua
describe login desactivado, pero la comprobación pública muestra que está
disponible actualmente.

El catálogo original contenía solo SARA, SARA Pad, SmartDoc y FimeBot. Sus dos
fragmentos de FimeBot (`/#fimebot` en JSON y `/#chat` en Astro) no coincidían con
el destino real `/#fimebot-chat`.

## Proyectos sin enlace de uso o instalación verificado

No deben presentarse como disponibles con un botón «Abrir» hasta contar con una
publicación utilizable. La existencia de código, integración de identidad o una
política de privacidad no demuestra la disponibilidad para estudiantes.

| Proyecto | Evidencia local y verificación | Qué falta para publicarlo en el catálogo |
| --- | --- | --- |
| SkillDex | `../../skilldex/README.md` describe perfiles, documentos y vacantes. `../../skilldex/apps/web/README.md` apunta a `https://skilldexapi.ici-labs.com`. Ese host no resolvió DNS durante esta revisión; no existen contenedores SkillDex en `cite-server`. | Frontend público verificado y backend disponible. No se encontró URL pública del frontend en el repositorio. |
| SARA Lab (`nexolab`) | `../../nexolab/README.md` describe préstamos, reservas e inventario de laboratorios. Solo documenta ejecución local y mantiene bloqueado el login web de producción hasta disponer de un BFF. No está desplegado en `cite-server`. | Publicación, acceso web de producción y enlace verificado. |
| SARA MD (`saraPhoneMD`) | `../../saraPhoneMD/README.md` describe editor Markdown local para Android/iOS. Política pública en https://privacy.ici-labs.com/sara-md/. No se encontró enlace de App Store, Google Play o descarga oficial en el código o documentación revisados. | Enlace oficial de instalación; no necesita cuenta para funcionar localmente. |
| InSituLab (`diario_isenco_app`) | App local de visitas de campo. Política pública en https://privacy.ici-labs.com/insitulab/. `AppStoreListing.md` todavía contiene URLs de ejemplo para soporte y marketing; no se encontró enlace de instalación. | Enlace oficial de instalación y confirmar pertinencia para la audiencia de FIME. |
| SARA móvil (`sara_mobile`) | Cliente Flutter con configuración del autenticador central y de producción; no se encontró enlace de tienda o descarga publicado. | Enlace oficial de instalación. Puede incluirse como plataforma adicional en la ficha de SARA. |

La revisión de enlaces de instalación fue estática sobre los repositorios; no
equivale a afirmar que estas aplicaciones nunca se hayan publicado por otra vía.
Los repositorios bajo `legacy-archive` no se incluyeron como productos activos.

## Recursos y exclusiones

- https://privacy.ici-labs.com respondió HTTP 200 y es un recurso de privacidad,
  adecuado para el pie de página, no una herramienta de estudio independiente.
- https://ici-labs.com respondió HTTP 404; no usarlo como destino de soporte
  mientras ese estado persista.
- AgentAgenda, Immich y Jellyfin son aplicaciones personales separadas por
  instrucción del propietario. No forman parte del catálogo ni de la integración
  de autenticación de FIME.
- Bases de datos, colas, servicios de IA, workers y autenticador central son
  infraestructura. No deben llenar el menú de aplicaciones de los estudiantes.

## Método reproducible

Las comprobaciones públicas se hicieron con `curl -L --max-time 15` y sin
credenciales: se registraron estado HTTP, URL final y título cuando correspondía.
Se consultó `docker ps` y `docker ps -a` por SSH, sin alterar contenedores,
configuración, cuentas ni datos. Los endpoints identificados como no publicados
requieren nueva comprobación antes de cualquier alta futura en el catálogo.

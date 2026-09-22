# Mapa público del campus

El mapa usa Leaflet, empaquetado con la aplicación, y dos vistas sin API key:

- **Calles · OpenStreetMap:** teselas estándar de `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, con atribución visible, caché HTTP normal del navegador y un Referer de origen. Solo se solicitan imágenes para la vista interactiva. El zoom 20–21 amplía teselas del nivel 19, sin pedir niveles inexistentes.
- **Plano del campus:** los polígonos y el directorio de `public/campus.geojson`, servidos por este sitio. No carga teselas ni imágenes externas. La búsqueda y los detalles funcionan también en esta vista. Se activa automáticamente tras varios errores del servicio de teselas.

Los datos cartográficos de OpenStreetMap son abiertos bajo ODbL. Su servidor comunitario de teselas tiene capacidad limitada y disponibilidad de mejor esfuerzo: no debe tratarse como un servicio ilimitado ni utilizarse para descargas masivas, precarga o paquetes sin conexión. Si aumenta el tráfico, se puede conservar Leaflet y alojar cartografía propia o cambiar a un proveedor con condiciones apropiadas.

Fuentes: [licencia de OpenStreetMap](https://www.openstreetmap.org/copyright), [política del servicio de teselas](https://operations.osmfoundation.org/policies/tiles/), [documentación de Leaflet](https://leafletjs.com/reference.html).

No se incluyen capturas de Google Earth ni otra fotografía cuya licencia de reutilización no se haya verificado. El plano muestra los edificios ya registrados; no pretende ser una imagen satelital.

La página pública es de solo lectura, incluso con `?edit=true`. Para mantener edificios y aulas se debe actualizar el GeoJSON por el flujo de administración del servidor. No habilitar escritura pública hasta contar con autenticación administrativa real. El despliegue debe preservar el GeoJSON vigente del servidor, que puede contener actualizaciones posteriores a la copia del repositorio.

// Public map data is maintained in campus.geojson through the deployment process.
// A selected group cookie is not an authenticated administrator session.
export const POST = async () => new Response(JSON.stringify({
  error: 'La edición pública del mapa está deshabilitada.'
}), {
  status: 403,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

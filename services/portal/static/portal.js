const grid = document.querySelector('#app-grid');
let apps = [], category = 'Todas';
function node(tag, text, className) { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; }
function render() {
  const query = document.querySelector('#search').value.trim().toLocaleLowerCase('es');
  const visible = apps.filter(a => (category === 'Todas' || a.category === category) && `${a.name} ${a.description} ${a.category}`.toLocaleLowerCase('es').includes(query));
  grid.replaceChildren();
  document.querySelector('#app-count').textContent = `${visible.length} ${visible.length === 1 ? "aplicación" : "aplicaciones"} para explorar`;
  for (const a of visible) {
    const card = node('article', '', 'app-card'); card.dataset.id = a.id;
    const top = node('div', '', 'card-top'); top.append(node('span', a.icon, 'app-icon'), node('span', a.access, 'access'));
    const bottom = node('div', '', 'card-bottom'); const link = node('a', 'Abrir aplicación ↗'); link.href = a.url; link.setAttribute('aria-label', `Abrir ${a.name}`);
    bottom.append(node('span', a.category), link);
    card.append(top, node('h3', a.name), node('p', a.label, 'card-label'), node('p', a.description, 'card-description'), bottom); grid.append(card);
  }
  if (!visible.length) grid.append(node('p', 'No encontramos aplicaciones con esa búsqueda. Prueba con otro nombre.'));
}
document.querySelectorAll('[data-category]').forEach(b => b.addEventListener('click', () => {
  category = b.dataset.category;
  document.querySelectorAll('[data-category]').forEach(other => { other.classList.toggle('selected', other === b); other.setAttribute('aria-pressed', String(other === b)); }); render();
}));
document.querySelector('#search').addEventListener('input', render);
fetch('/api/apps').then(r => { if (!r.ok) throw Error(); return r.json(); }).then(data => { apps = data; render(); }).catch(() => grid.replaceChildren(node('p', 'No se pudo cargar el catálogo. Recarga la página para intentar de nuevo.')));
async function session() {
  try {
    let r = await fetch('/session/me');
    if (r.status === 401) { const renewed = await fetch('/session/refresh', {method:'POST'}); if (renewed.ok) r = await fetch('/session/me'); }
    if (r.ok) {
      const {user} = await r.json(); document.querySelector('#welcome').textContent = `Hola, ${user.name || 'bienvenido'}. Elige una herramienta para comenzar.`;
      document.querySelector('#login').hidden = true; document.querySelector('#logout').hidden = false;
    } else if (r.status !== 401) document.querySelector('#welcome').textContent = 'No pudimos verificar tu sesión. Intenta de nuevo en unos momentos.';
  } catch { document.querySelector('#welcome').textContent = 'No pudimos conectar con el servicio de acceso.'; }
}
session();
document.querySelector('#logout').addEventListener('click', async (event) => {
  event.target.disabled = true;
  try { const r = await fetch('/session/logout', {method:'POST'}); if (!r.ok) throw Error(); location.reload(); }
  catch { document.querySelector('#welcome').textContent = 'No se pudo confirmar el cierre de sesión. Intenta de nuevo.'; event.target.disabled = false; }
});
const conversation = document.querySelector('#conversation');
document.querySelector('#chat-form').addEventListener('submit', async event => {
  event.preventDefault(); const input = document.querySelector('#question'); const question = input.value.trim(); if (!question) return;
  const button = event.currentTarget.querySelector('button'); button.disabled = true;
  conversation.append(node('p', question, 'user-message')); const answer = node('p', 'Consultando…', 'bot-message'); conversation.append(answer); conversation.scrollTop = conversation.scrollHeight; input.value = '';
  try {
    const r = await fetch('/api/chat', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({messages:[{role:'user',content:question}],stream:false})});
    const data = await r.json(); if (!r.ok) throw Error(typeof data.detail === 'string' ? data.detail : 'No se pudo obtener una respuesta.');
    answer.textContent = data.message.content.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    for (const source of data.sources || []) {
      try {
        const url = new URL(source.url);
        if (url.protocol !== 'https:' || !(url.hostname === 'ucol.mx' || url.hostname.endsWith('.ucol.mx'))) continue;
        const link = node('a', source.title); link.href = url.href; link.className = 'source-link'; answer.append(document.createElement('br'), link);
      } catch { /* Ignore malformed source links. */ }
    }
  } catch(error) { answer.textContent = `${error.message} Intenta de nuevo en un momento.`; }
  finally { button.disabled = false; conversation.scrollTop = conversation.scrollHeight; input.focus(); }
});

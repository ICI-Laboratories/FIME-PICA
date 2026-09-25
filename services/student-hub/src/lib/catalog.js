/** Normalize human search input without making accents a requirement. */
export function normalizeSearch(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
}

/** Fail the build for broken catalog entries instead of publishing invalid links. */
export function validateCatalog(entries) {
  const ids = new Set();
  for (const entry of entries) {
    for (const field of ['id', 'name', 'category', 'description', 'url', 'access']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) throw new Error(`Missing catalog ${field}`);
    }
    if (!/^[a-z][a-z0-9-]*$/.test(entry.id) || ids.has(entry.id)) throw new Error(`Invalid or duplicate app id: ${entry.id}`);
    ids.add(entry.id);
    const url = new URL(entry.url, 'https://fime.ici-labs.com');
    if (url.protocol !== 'https:' || url.username || url.password || entry.url.startsWith('//')) throw new Error(`Unsafe app URL: ${entry.id}`);
    if (entry.aliases && (!Array.isArray(entry.aliases) || entry.aliases.some(alias => typeof alias !== 'string'))) throw new Error(`Invalid aliases: ${entry.id}`);
  }
  return entries;
}

export function searchText(entry) {
  return normalizeSearch([entry.name, entry.category, entry.description, ...(entry.aliases ?? [])].join(' '));
}

export function matchesSearch(text, query) {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const normalized = normalizeSearch(text);
  return terms.every(term => normalized.includes(term));
}

export function matchesApp(entry, query = '', category = '') {
  return (!category || entry.category === category) && matchesSearch(searchText(entry), query);
}

export function resultLabel(count) {
  return `${count} ${count === 1 ? 'herramienta disponible' : 'herramientas disponibles'}`;
}

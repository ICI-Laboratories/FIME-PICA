import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchesApp, matchesSearch, normalizeSearch, resultLabel, validateCatalog } from '../src/lib/catalog.js';

const catalog = JSON.parse(await readFile(new URL('../../portal/apps.json', import.meta.url)));
test('published catalog has unique identities and safe usable links', () => {
  assert.equal(validateCatalog(catalog), catalog);
  assert.throws(() => validateCatalog([...catalog,catalog[0]]), /duplicate/);
  for (const url of ['javascript:alert(1)', '//evil.invalid', 'https://user:pass@example.com']) {
    assert.throws(() => validateCatalog([{...catalog[0],url}]), /Unsafe/);
  }
});
test('search accepts accents, aliases, reordered words and combined category filters', () => {
  assert.equal(normalizeSearch('  Programación  '), 'programacion');
  const doc = catalog.find(app => app.id === 'smartdoc');
  assert.ok(matchesApp(doc, 'smartdoc'));
  assert.ok(matchesApp(doc, 'lector documentos'));
  assert.ok(!matchesApp(doc, 'smartdoc', 'Programación'));
  assert.ok(matchesSearch('Mapa del campus Coquimatlán', 'coquimatlan mapa'));
  assert.ok(!matchesSearch('Mapa del campus', 'mapa documentos'));
});
test('public tools remain discoverable without requiring a SARA account', () => {
  for (const id of ['studenthub','mapa','profesores']) assert.equal(catalog.find(app=>app.id===id).access,'Sin cuenta');
  assert.equal(catalog.find(app=>app.id==='fimebot').url,'/#fimebot-chat');
  assert.equal(resultLabel(1),'1 herramienta disponible');
  assert.equal(resultLabel(0),'0 herramientas disponibles');
});

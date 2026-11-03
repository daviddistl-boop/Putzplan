const test = require('node:test');
const assert = require('node:assert');
const Sh = require('../shopping.js');

test('Katalog: rund 250 Artikel, eindeutige Schlüssel, jede Kategorie gefüllt', () => {
  assert.ok(Sh.CATALOG.length >= 250, `nur ${Sh.CATALOG.length}`);
  assert.strictEqual(new Set(Sh.CATALOG.map((i) => i.key)).size, Sh.CATALOG.length);
  for (const c of Sh.CATEGORIES) assert.ok(Sh.CATALOG.some((i) => i.cat === c.key), c.key);
});

test('Suche: Wortanfang vor Treffern mitten im Wort, Suchwörter und Umlaute', () => {
  assert.deepStrictEqual(Sh.search('mil').slice(0, 2).map((i) => i.name), ['Milch', 'Hafermilch']);
  assert.strictEqual(Sh.search('klopapier')[0].name, 'Toilettenpapier');
  assert.strictEqual(Sh.search('mohren')[0], undefined);
  assert.strictEqual(Sh.search('möhren')[0].name, 'Karotten');
  assert.strictEqual(Sh.search('schwamme')[0], undefined);
  assert.strictEqual(Sh.search('schwämme')[0].name, 'Schwämme');
  assert.deepStrictEqual(Sh.search(''), []);
});

test('Freie Artikel bekommen ein passendes Symbol', () => {
  assert.strictEqual(Sh.iconFor('Bio Milch', 'other'), '🥛');
  assert.strictEqual(Sh.iconFor('Geschenk für Oma', 'other'), '🎁');
  assert.strictEqual(Sh.iconFor('Schrauben', 'other'), '🛍️');
  assert.strictEqual(Sh.findByName('Mayo').name, 'Mayonnaise');
});

test('Vorschläge passen zur Aufgabe', () => {
  const names = (t) => Sh.suggestionsFor(t).map((i) => i.name);
  assert.ok(names('Toilette putzen').includes('WC-Reiniger'));
  assert.ok(names('Fenster putzen').includes('Glasreiniger'));
  assert.strictEqual(names('Staubbehälter leeren')[0], 'Ersatzfilter Saugroboter');
  assert.ok(names('Geschirr spülen / Spülmaschine').includes('Spülmaschinentabs'));
  assert.ok(names('🪴 Monstera umtopfen').includes('Blumenerde'));
  assert.ok(names('Irgendwas').length >= 3, 'allgemeine Putzmittel als Rückfall');
});

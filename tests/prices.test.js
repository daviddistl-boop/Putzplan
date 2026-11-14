const test = require('node:test');
const assert = require('node:assert');
const P = require('../prices.js');

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 14);
const p = (key, storeId, cents, daysAgo) => ({ id: `${key}-${storeId}-${daysAgo}`, key, storeId, cents, at: NOW - daysAgo * DAY });

test('Euro-Eingaben werden zu Cent', () => {
  assert.strictEqual(P.parseEuro('1,79'), 179);
  assert.strictEqual(P.parseEuro('1.79 €'), 179);
  assert.strictEqual(P.parseEuro('2'), 200);
  assert.strictEqual(P.parseEuro('0,5'), 50);
  assert.strictEqual(P.parseEuro('12,345'), null);
  assert.strictEqual(P.parseEuro('abc'), null);
  assert.strictEqual(P.parseEuro('0'), null);
  assert.strictEqual(P.formatEuro(179), '1,79 €');
});

test('Preis-Schlüssel: Katalog oder normalisierter Name', () => {
  assert.strictEqual(P.priceKey({ key: 'butter', name: 'Butter' }), 'butter');
  assert.strictEqual(P.priceKey({ key: null, name: '  Hafer  Drink ' }), 'n:hafer drink');
});

test('üblicher Preis: Median der letzten drei, Aktionen schlagen nicht voll durch', () => {
  const prices = [p('butter', 'aldi', 179, 30), p('butter', 'aldi', 119, 10), p('butter', 'aldi', 189, 2)];
  assert.strictEqual(P.storePrice(prices, 'butter', 'aldi', NOW).cents, 179);
  assert.strictEqual(P.storePrice(prices, 'butter', 'rewe', NOW), null);
});

test('alte Preise: jüngster zählt, ist aber als alt markiert', () => {
  const r = P.storePrice([p('milch', 'rewe', 99, 200), p('milch', 'rewe', 89, 150)], 'milch', 'rewe', NOW);
  assert.deepStrictEqual([r.cents, r.stale], [89, true]);
});

test('addPrice räumt auf: höchstens 6 je Artikel und Markt, nichts älter als ein Jahr', () => {
  let prices = [p('milch', 'aldi', 99, 400)];
  for (let i = 0; i < 8; i++) prices = P.addPrice(prices, p('milch', 'aldi', 100 + i, i), NOW);
  assert.strictEqual(prices.length, 6);
  assert.ok(prices.every((x) => x.cents >= 100));
});

test('Artikelvergleich: günstigster zuerst', () => {
  const prices = [p('butter', 'aldi', 179, 1), p('butter', 'rewe', 229, 1), p('butter', 'lidl', 169, 1)];
  assert.deepStrictEqual(P.compareItem(prices, 'butter', ['aldi', 'rewe', 'lidl', 'edeka'], NOW).map((x) => x.storeId), ['lidl', 'aldi', 'rewe']);
});

test('Einkaufsvergleich: fair nur über gemeinsame Artikel, plus Aufteilen', () => {
  const prices = [
    p('butter', 'aldi', 179, 1), p('butter', 'rewe', 229, 1),
    p('milch', 'aldi', 99, 1), p('milch', 'rewe', 89, 1),
    p('kaffee', 'rewe', 699, 1), // nur bei Rewe bekannt → nicht im fairen Vergleich
  ];
  const b = P.basket(prices, ['butter', 'milch', 'kaffee', 'brot'], ['aldi', 'rewe'], NOW);
  assert.deepStrictEqual(b.commonKeys, ['butter', 'milch']);
  assert.deepStrictEqual(b.common.map((c) => [c.storeId, c.total]), [['aldi', 278], ['rewe', 318]]);
  assert.strictEqual(b.best.storeId, 'aldi');
  assert.deepStrictEqual(b.perStore.find((s) => s.storeId === 'rewe').missing, ['brot']);
  assert.deepStrictEqual([b.split.total, b.split.saving, b.split.stores.sort()], [268, 10, ['aldi', 'rewe']]);
});

test('Einkaufsvergleich mit nur einem Markt: keine Empfehlung', () => {
  const b = P.basket([p('butter', 'aldi', 179, 1)], ['butter'], ['aldi', 'rewe'], NOW);
  assert.strictEqual(b.best, null);
  assert.strictEqual(b.perStore.length, 1);
});

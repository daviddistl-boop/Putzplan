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

test('Mengen lesen und anzeigen', () => {
  assert.deepStrictEqual(P.parseQty('275 g'), { amount: 0.275, base: 'kg' });
  assert.deepStrictEqual(P.parseQty('1,5l'), { amount: 1.5, base: 'l' });
  assert.deepStrictEqual(P.parseQty('6 x 0,5 l'), { amount: 3, base: 'l' });
  assert.deepStrictEqual(P.parseQty('10 Stk'), { amount: 10, base: 'Stk' });
  assert.deepStrictEqual(P.parseQty('500ml'), { amount: 0.5, base: 'l' });
  assert.deepStrictEqual(P.parseQty('1 kg'), { amount: 1, base: 'kg' });
  assert.strictEqual(P.parseQty('groß'), null);
  assert.strictEqual(P.parseQty(''), null);
  assert.strictEqual(P.formatQty({ amount: 0.275, base: 'kg' }), '275 g');
  assert.strictEqual(P.formatQty({ amount: 1.5, base: 'l' }), '1,5 l');
  assert.strictEqual(P.formatQty({ amount: 6, base: 'Stk' }), '6 Stk');
  assert.strictEqual(P.formatUnitPrice(179, { amount: 0.275, base: 'kg' }), '6,51 €/kg');
});

const vp = (storeId, variantId, cents, daysAgo) => Object.assign(p('knaecke', storeId, cents, daysAgo), { id: `${storeId}-${variantId}-${daysAgo}`, variantId });
const KN = [{ id: 'wasa', name: 'Wasa Roggen', qty: { amount: 0.275, base: 'kg' } }, { id: 'clever', name: 'Clever', qty: { amount: 0.25, base: 'kg' } }, { id: 'gross', name: 'Familienpackung', qty: { amount: 0.5, base: 'kg' } }];

test('Sorte gewählt: nur Preise dieser Sorte zählen', () => {
  const prices = [vp('billa', 'wasa', 229, 1), vp('billa', 'clever', 119, 1), vp('spar', 'wasa', 249, 2)];
  const o = P.itemOffer(prices, { key: 'knaecke', variantId: 'wasa' }, KN, 'billa', NOW);
  assert.deepStrictEqual([o.cents, o.variantId, Math.round(o.unit)], [229, 'wasa', 833]);
  assert.strictEqual(P.itemOffer(prices, { key: 'knaecke', variantId: 'clever' }, KN, 'spar', NOW), null);
});

test('„Egal welche“: günstigster Grundpreis, auf die übliche Packung umgerechnet', () => {
  const prices = [vp('billa', 'wasa', 229, 1), vp('billa', 'clever', 119, 3), vp('spar', 'gross', 299, 2)];
  const ref = P.usualQty(prices, 'knaecke', KN);
  assert.deepStrictEqual(ref, { amount: 0.275, base: 'kg' }); // zuletzt gekauft: Wasa 275 g
  const billa = P.itemOffer(prices, { key: 'knaecke' }, KN, 'billa', NOW, ref);
  const spar = P.itemOffer(prices, { key: 'knaecke' }, KN, 'spar', NOW, ref);
  assert.deepStrictEqual([billa.variantId, billa.cents, billa.packCents], ['clever', 131, 119]); // 4,76 €/kg × 0,275 kg
  assert.deepStrictEqual([spar.variantId, spar.cents], ['gross', 164]); // 5,98 €/kg × 0,275 kg
  const resolve = (key, storeId) => P.itemOffer(prices, { key }, KN, storeId, NOW, ref);
  assert.deepStrictEqual(P.compareItem(resolve, 'knaecke', ['spar', 'billa']).map((x) => x.storeId), ['billa', 'spar']);
});

test('„Egal welche“ ohne Mengen: alte Preise ohne Sorte zählen wie bisher', () => {
  const prices = [p('knaecke', 'billa', 199, 1), vp('billa', 'wasa', 229, 2)];
  assert.strictEqual(P.itemOffer(prices, { key: 'knaecke' }, [{ id: 'wasa', name: 'Wasa' }], 'billa', NOW).cents, 199);
  assert.strictEqual(P.itemOffer(prices, { key: 'knaecke' }, KN, 'billa', NOW).variantId, 'wasa'); // mit Menge gewinnt der Grundpreis
});

test('Preise je Sorte werden getrennt aufgehoben', () => {
  let list = [];
  for (let i = 0; i < 8; i++) list = P.addPrice(list, vp('billa', 'wasa', 200 + i, i), NOW);
  list = P.addPrice(list, vp('billa', 'clever', 119, 0), NOW);
  assert.strictEqual(list.filter((x) => x.variantId === 'wasa').length, P.KEEP_PER_STORE);
  assert.strictEqual(list.filter((x) => x.variantId === 'clever').length, 1);
});

test('Ketten: Filialen gleichen Namens teilen sich die Preise', () => {
  const stores = [{ id: 'b1', name: 'Billa' }, { id: 's1', name: 'Spar' }, { id: 'b2', name: 'BILLA' }, { id: 'bp', name: 'Billa Plus' }];
  const c = P.chains(stores);
  assert.deepStrictEqual(c.ids, ['b1', 's1', 'bp']);
  assert.deepStrictEqual([c.of.b2, c.of.b1, c.of.bp], ['b1', 'b1', 'bp']);
  const prices = P.pricesByChain([p('butter', 'b2', 189, 1), p('butter', 's1', 199, 1)], c);
  assert.deepStrictEqual(P.compareItem(prices, 'butter', c.ids, NOW).map((x) => [x.storeId, x.price.cents]), [['b1', 189], ['s1', 199]]);
});

test('Warenkorb mit Auflöser (Sorten/Ketten)', () => {
  const table = { a: { x: 100, y: 120 }, b: { x: 300, y: 250 } };
  const b = P.basket((k, s) => (table[k] && table[k][s] ? { cents: table[k][s] } : null), ['a', 'b'], ['x', 'y']);
  assert.deepStrictEqual([b.best.storeId, b.common.map((c) => c.total), b.split.saving], ['y', [370, 400], 20]);
});

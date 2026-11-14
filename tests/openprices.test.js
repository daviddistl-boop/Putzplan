const test = require('node:test');
const assert = require('node:assert');
const OP = require('../openprices.js');

const sample = (over) => Object.assign({
  price: 2.49, currency: 'EUR', date: '2026-11-10', price_is_discounted: false, product_code: '4012345678901',
  product: { code: '4012345678901', product_name: 'Butter', brands: 'Kerrygold', product_quantity: 250, product_quantity_unit: 'g' },
  location: { osm_name: 'Lidl', osm_address_city: 'Berlin', osm_address_country_code: 'DE' },
}, over);

test('normalisiert einen Preis-Eintrag', () => {
  assert.deepStrictEqual(OP.normalizePrice(sample()), {
    cents: 249, currency: 'EUR', per: null, discounted: false, date: '2026-11-10', product: 'Butter', brand: 'Kerrygold',
    quantity: '250 g', code: '4012345678901', store: 'Lidl', city: 'Berlin', country: 'DE',
  });
});

test('tolerant bei fehlenden Feldern', () => {
  const p = OP.normalizePrice({ price: '1.2', location: { osm_display_name: 'REWE, Hauptstraße 1, München' } });
  assert.strictEqual(p.cents, 120);
  assert.strictEqual(p.store, 'REWE');
  assert.strictEqual(OP.normalizePrice({ price: 0 }), null);
  assert.strictEqual(OP.normalizePrice(null), null);
});

test('sortiert: eigener Ort zuerst, dann jüngste; nur Euro und eigenes Land', () => {
  const list = [
    sample({ date: '2026-11-12', location: { osm_name: 'Aldi', osm_address_city: 'Hamburg', osm_address_country_code: 'DE' } }),
    sample({ date: '2026-11-01' }),
    sample({ date: '2026-11-13', currency: 'CHF' }),
    sample({ date: '2026-11-13', location: { osm_name: 'Spar', osm_address_city: 'Wien', osm_address_country_code: 'AT' } }),
  ].map(OP.normalizePrice);
  const r = OP.rank(list, { country: 'DE', city: 'berlin' });
  assert.deepStrictEqual(r.map((x) => [x.store, x.local]), [['Lidl', true], ['Aldi', false]]);
});

test('Suche: Obst über die Kategorie, sonst Produkte per Name', async () => {
  const urls = [];
  const fake = async (url) => {
    urls.push(url);
    let body = { items: [] };
    if (url.includes('category_tag=en%3Abananas')) body = { items: [sample({ product: {}, price: 1.29, price_per: 'KILOGRAM' })] };
    if (url.includes('/products?')) body = { items: [{ code: '111' }, { code: '222' }] };
    if (url.includes('product_code=111')) body = { items: [sample()] };
    return { ok: true, json: async () => body };
  };
  const bananas = await OP.search({ name: 'Bananen', key: 'bananen' }, { country: 'DE' }, fake);
  assert.deepStrictEqual([bananas.length, bananas[0].cents, bananas[0].per], [1, 129, 'KILOGRAM']);
  const butter = await OP.search({ name: 'Butter', key: 'butter' }, { country: 'DE' }, fake);
  assert.strictEqual(butter[0].product, 'Butter');
  assert.ok(urls.some((u) => u.includes('product_name__like=Butter')));
});

test('Fehler der Schnittstelle werden gemeldet', async () => {
  await assert.rejects(OP.search({ name: 'Butter' }, {}, async () => ({ ok: false, status: 503 })), /503/);
});

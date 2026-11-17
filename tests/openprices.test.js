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
    quantity: '250 g', code: '4012345678901', store: 'Lidl', city: 'Berlin', osmId: null, country: 'DE',
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

test('Barcode: Ziffern prüfen und Produkt nachschlagen (echte Antwort)', async () => {
  assert.strictEqual(OP.cleanCode(' 7300400481588 '), '7300400481588');
  assert.strictEqual(OP.cleanCode('123'), null);
  const urls = [];
  const fake = async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => ({ code: '7300400481588', product_name: 'Fibres', product_quantity: 230, product_quantity_unit: 'g', quantity: '230 g', brands: 'wasa, Barilla Sverige AB', image_url: 'https://images.openfoodfacts.org/x.jpg' }) }; };
  const p = await OP.product('7300400481588', fake);
  assert.strictEqual(urls[0], 'https://prices.openfoodfacts.org/api/v1/products/code/7300400481588');
  assert.deepStrictEqual([p.name, p.brand, p.quantity], ['Wasa Fibres', 'Wasa', '230 g']);
  assert.strictEqual(await OP.product('7300400481588', async () => ({ ok: false, status: 404, json: async () => ({}) })), null);
});

test('Anmelden: Benutzername und Passwort → Token', async () => {
  let sent;
  const fake = async (url, init) => { sent = { url, init }; return { ok: true, status: 200, json: async () => ({ user_id: 'david', access_token: 'tok123', token_type: 'bearer', is_moderator: false }) }; };
  assert.deepStrictEqual(await OP.login(' david ', 'geheim&1', fake), { user: 'david', token: 'tok123' });
  assert.strictEqual(sent.url, 'https://prices.openfoodfacts.org/api/v1/auth');
  assert.strictEqual(sent.init.body, 'username=david&password=geheim%261');
  await assert.rejects(OP.login('x', 'y', async () => ({ ok: false, status: 401, json: async () => ({ detail: 'Invalid authentication credentials' }) })), /Invalid authentication/);
});

test('Preis teilen: erst Beleg-Foto, dann Preis mit Filiale und Barcode', async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/proofs/upload')) return { ok: true, status: 201, json: async () => ({ id: 77 }) };
    return { ok: true, status: 201, json: async () => ({ id: 991 }) };
  };
  const photo = new Blob(['x'], { type: 'image/jpeg' });
  const r = await OP.sharePrice({ token: 'tok', code: '7300400481588', cents: 229, discounted: false, osmId: '4543432771', osmType: 'N', at: new Date(2026, 10, 17, 12).getTime(), photo }, fake);
  assert.deepStrictEqual(r, { proofId: 77, priceId: 991 });
  const form = calls[0].init.body;
  assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.deepStrictEqual([form.get('type'), form.get('location_osm_type'), form.get('location_osm_id'), form.get('date'), form.get('currency')], ['PRICE_TAG', 'NODE', '4543432771', '2026-11-17', 'EUR']);
  const body = JSON.parse(calls[1].init.body);
  assert.deepStrictEqual(body, { type: 'PRODUCT', product_code: '7300400481588', price: 2.29, price_is_discounted: false, currency: 'EUR', date: '2026-11-17', location_osm_id: 4543432771, location_osm_type: 'NODE', proof_id: 77 });
});

test('Preis teilen: fehlende Angaben werden vor dem Senden erkannt', async () => {
  const never = async () => { throw new Error('darf nicht senden'); };
  const base = { token: 't', code: '7300400481588', cents: 100, osmId: '1', osmType: 'N', photo: new Blob(['x']) };
  await assert.rejects(OP.sharePrice(Object.assign({}, base, { token: '' }), never), /angemeldet/);
  await assert.rejects(OP.sharePrice(Object.assign({}, base, { osmId: null }), never), /OpenStreetMap/);
  await assert.rejects(OP.sharePrice(Object.assign({}, base, { photo: null }), never), /Foto/);
  await assert.rejects(OP.sharePrice(Object.assign({}, base, { code: '12' }), never), /Barcode/);
});

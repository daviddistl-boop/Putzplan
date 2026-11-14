const test = require('node:test');
const assert = require('node:assert');
const PL = require('../places.js');

const feature = (props, lon, lat) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props });
const WIEN_1050 = { lat: 48.1886, lon: 16.3542 };

test('Ort: Postleitzahl wird zu „Wien, Margareten, 1050“', () => {
  const p = PL.normalizePlace(feature({ osm_key: 'boundary', osm_value: 'postal_code', type: 'postcode', name: '1050', postcode: '1050', city: 'Wien', district: 'Margareten', countrycode: 'AT' }, 16.354, 48.188));
  assert.deepStrictEqual([p.label, p.city, p.district, p.postcode, p.country], ['Wien, Margareten, 1050', 'Wien', 'Margareten', '1050', 'AT']);
});

test('Ort: echte Photon-Antwort für „1050“ (Postleitzahl nur als Name, Katastralgemeinde)', () => {
  const p = PL.normalizePlace(feature({ osm_type: 'R', osm_id: 7917316, osm_key: 'place', osm_value: 'postcode', type: 'other', name: '1050', district: 'Katastralgemeinde Margarethen', city: 'Wien', countrycode: 'AT' }, 16.35594, 48.18680));
  assert.deepStrictEqual([p.label, p.district, p.postcode], ['Wien, Margareten, 1050', 'Margareten', '1050']);
  const graz = PL.normalizePlace(feature({ osm_key: 'place', osm_value: 'postcode', type: 'other', name: '8010', district: 'Katastralgemeinde Innere Stadt', city: 'Graz', countrycode: 'AT' }, 15.44, 47.07));
  assert.deepStrictEqual([graz.label, graz.postcode], ['Graz, Innere Stadt, 8010', '8010']);
});

test('Ort: Stadt und Bezirk, Straßen werden aussortiert', () => {
  assert.strictEqual(PL.normalizePlace(feature({ osm_key: 'place', osm_value: 'city', type: 'city', name: 'Graz', countrycode: 'AT' }, 15.43, 47.07)).label, 'Graz');
  assert.strictEqual(PL.normalizePlace(feature({ osm_key: 'place', osm_value: 'suburb', type: 'district', name: 'Margareten', city: 'Wien', countrycode: 'AT' }, 16.35, 48.18)).label, 'Wien, Margareten');
  assert.strictEqual(PL.normalizePlace(feature({ osm_key: 'highway', osm_value: 'residential', type: 'street', name: 'Hauptstraße', city: 'Wien' }, 16, 48)), null);
  assert.strictEqual(PL.normalizePlace({ properties: { type: 'city', name: 'X' } }), null);
});

test('Ortssuche: Land filtern, doppelte entfernen, kurze Eingaben nicht senden', async () => {
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ features: [
      feature({ type: 'postcode', name: '1050', postcode: '1050', city: 'Wien', district: 'Margareten', countrycode: 'AT' }, 16.35, 48.18),
      feature({ type: 'postcode', name: '1050', postcode: '1050', city: 'Wien', district: 'Margareten', countrycode: 'AT' }, 16.36, 48.19),
      feature({ type: 'postcode', name: '1050', postcode: '1050', city: 'Bruxelles', countrycode: 'BE' }, 4.37, 50.83),
    ] }) };
  };
  const r = await PL.searchPlaces('1050', { country: 'AT' }, fake);
  assert.deepStrictEqual(r.map((p) => p.label), ['Wien, Margareten, 1050']);
  assert.ok(calls[0].includes('q=1050') && calls[0].includes('lang=de'));
  assert.deepStrictEqual(await PL.searchPlaces('1', {}, fake), []);
  assert.strictEqual(calls.length, 1);
});

const photonOnly = (feats) => async () => {
  return { ok: true, json: async () => ({ features: feats }) };
};

test('Marktsuche über Photon: nur Geschäfte im Kasten um den Ort, nächste zuerst, mit Adresse', async () => {
  const urls = [];
  const feats = [
    feature({ osm_key: 'shop', osm_value: 'supermarket', osm_type: 'N', osm_id: 2, name: 'BILLA', street: 'Margaretenstraße', housenumber: '120', postcode: '1050', city: 'Wien' }, 16.351, 48.189),
    feature({ osm_key: 'shop', osm_value: 'supermarket', osm_type: 'N', osm_id: 1, name: 'BILLA', street: 'Reinprechtsdorfer Straße', housenumber: '32', postcode: '1050', city: 'Wien' }, 16.3545, 48.1888),
    feature({ osm_key: 'shop', osm_value: 'supermarket', osm_type: 'N', osm_id: 1, name: 'BILLA', street: 'Reinprechtsdorfer Straße', housenumber: '32', postcode: '1050', city: 'Wien' }, 16.3545, 48.1888),
    feature({ osm_key: 'amenity', osm_value: 'restaurant', name: 'Billa Bar' }, 16.355, 48.188),
    feature({ osm_key: 'shop', osm_value: 'supermarket', osm_id: 3, name: 'BILLA', city: 'Salzburg' }, 13.04, 47.8),
  ];
  const base = photonOnly(feats);
  const r = await PL.searchStores('billa', WIEN_1050, async (url) => { urls.push(url); return base(url); });
  assert.deepStrictEqual(r.map((s) => s.address), ['Reinprechtsdorfer Straße 32, 1050 Wien', 'Margaretenstraße 120, 1050 Wien']);
  assert.ok(r[0].km < r[1].km && r[0].km < 0.1);
  assert.strictEqual(r[0].osmId, '1');
  assert.ok(urls[0].startsWith(PL.BASE) && urls[0].includes('q=billa') && urls[0].includes('osm_tag=shop') && urls[0].includes('bbox='));
});

test('Kasten um den Ort: etwa ±2,5 km', () => {
  const [w, s, e, n] = PL.bboxAround({ lat: 48.1886, lon: 16.3542 }, 2500).split(',').map(Number);
  assert.ok(Math.abs(PL.distanceKm({ lat: s, lon: 16.3542 }, { lat: n, lon: 16.3542 }) - 5) < 0.05);
  assert.ok(Math.abs(PL.distanceKm({ lat: 48.1886, lon: w }, { lat: 48.1886, lon: e }) - 5) < 0.05);
});

test('Entfernung und Anzeige', () => {
  assert.ok(Math.abs(PL.distanceKm({ lat: 48.2082, lon: 16.3738 }, { lat: 47.0707, lon: 15.4395 }) - 145) < 3); // Wien–Graz
  assert.strictEqual(PL.formatDistance(0.34), '350\u00a0m');
  assert.strictEqual(PL.formatDistance(2.46), '2,5\u00a0km');
  assert.strictEqual(PL.formatDistance(NaN), '');
});

const NEAR = { lat: 48.1886, lon: 16.3542, postcode: '1050' };
const shop = (id, street, pc, lon, lat) => feature({ osm_key: 'shop', osm_value: 'supermarket', osm_type: 'N', osm_id: id, name: 'BILLA', street, postcode: pc, city: 'Wien' }, lon, lat);

test('Filialsuche: eigene Postleitzahl zuerst, dann nach Entfernung', async () => {
  const fake = photonOnly([
    shop(1, 'Triester Straße', '1100', 16.3555, 48.1806), // 900 m, aber 1100
    shop(2, 'Reinprechtsdorfer Straße', '1050', 16.3546, 48.1889),
    shop(3, 'Pilgramgasse', '1050', 16.3560, 48.1925),
    shop(4, 'Margaretenstraße', '1050', 16.3505, 48.1902),
    shop(5, 'Rechte Wienzeile', '1040', 16.3600, 48.1890),
    shop(6, 'Wolfganggasse', '1120', 16.3380, 48.1790),
  ]);
  const r = await PL.searchStores('billa', NEAR, fake);
  assert.deepStrictEqual(r.map((s) => s.osmId), ['2', '4', '3', '5', '1', '6']);
  assert.deepStrictEqual(r.map((s) => s.samePostcode), [true, true, true, false, false, false]);
});

test('Filialsuche: Kasten wird vergrößert, wenn zu wenig gefunden', async () => {
  const boxes = [];
  const fake = async (url) => {
    const [w, , e] = decodeURIComponent(/bbox=([^&]+)/.exec(url)[1]).split(',').map(Number);
    boxes.push(Number((PL.distanceKm({ lat: 48.1886, lon: w }, { lat: 48.1886, lon: e }) / 2).toFixed(1)));
    const n = boxes.length === 1 ? 2 : 8;
    return { ok: true, json: async () => ({ features: Array.from({ length: n }, (_, i) => shop(100 + i, 'Gasse', '1100', 16.35, 48.18 - i * 0.001)) }) };
  };
  const r = await PL.searchStores('billa', NEAR, fake);
  assert.deepStrictEqual(boxes, [2.5, 7]); // ±2,5 km, dann ±7 km
  assert.strictEqual(r.length, 8);
});

test('Filialsuche: nicht erreichbar → Fehler statt „nichts gefunden“', async () => {
  await assert.rejects(PL.searchStores('billa', NEAR, async () => { throw new Error('offline'); }));
});

test('Rückwärtssuche: Koordinaten → Postleitzahl und Bezirk (echte Photon-Antwort)', async () => {
  const urls = [];
  const fake = async (url) => { urls.push(url); return { ok: true, json: async () => ({ type: 'FeatureCollection', features: [feature({ osm_type: 'R', osm_id: 7917316, osm_key: 'place', osm_value: 'postcode', type: 'other', name: '1050', district: 'Katastralgemeinde Margarethen', city: 'Wien', country: 'Österreich', countrycode: 'AT' }, 16.35594, 48.18680)] }) }; };
  const r = await PL.reversePlace(48.18680, 16.35594, fake);
  assert.ok(urls[0].startsWith('https://photon.komoot.io/reverse?lat=48.1868'));
  assert.deepStrictEqual(r, { label: 'Wien, Margareten, 1050', city: 'Wien', district: 'Margareten', postcode: '1050', country: 'AT' });
  const street = await PL.reversePlace(48.1, 16.3, async () => ({ ok: true, json: async () => ({ features: [feature({ osm_key: 'highway', type: 'street', name: 'Pilgramgasse', postcode: '1050', city: 'Wien', countrycode: 'AT' }, 16.3, 48.1)] }) }));
  assert.strictEqual(street.label, 'Wien, Margareten, 1050');
  assert.strictEqual(await PL.reversePlace(48.1, 16.3, async () => ({ ok: true, json: async () => ({ features: [] }) })), null);
});

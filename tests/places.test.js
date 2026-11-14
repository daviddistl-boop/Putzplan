const test = require('node:test');
const assert = require('node:assert');
const PL = require('../places.js');

const feature = (props, lon, lat) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props });
const WIEN_1050 = { lat: 48.1886, lon: 16.3542 };

test('Ort: Postleitzahl wird zu „Wien, Margareten, 1050“', () => {
  const p = PL.normalizePlace(feature({ osm_key: 'boundary', osm_value: 'postal_code', type: 'postcode', name: '1050', postcode: '1050', city: 'Wien', district: 'Margareten', countrycode: 'AT' }, 16.354, 48.188));
  assert.deepStrictEqual([p.label, p.city, p.district, p.postcode, p.country], ['Wien, Margareten, 1050', 'Wien', 'Margareten', '1050', 'AT']);
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

test('Marktsuche: nur Geschäfte in der Nähe, nächste zuerst, mit Adresse', async () => {
  const fake = async (url) => {
    assert.ok(url.includes('q=billa') && url.includes('lat=48.1886'));
    return { ok: true, json: async () => ({ features: [
      feature({ osm_key: 'shop', osm_value: 'supermarket', osm_type: 'N', osm_id: 2, name: 'BILLA', street: 'Margaretenstraße', housenumber: '120', postcode: '1050', city: 'Wien' }, 16.351, 48.189),
      feature({ osm_key: 'shop', osm_value: 'supermarket', osm_type: 'N', osm_id: 1, name: 'BILLA', street: 'Reinprechtsdorfer Straße', housenumber: '32', postcode: '1050', city: 'Wien' }, 16.3545, 48.1888),
      feature({ osm_key: 'shop', osm_value: 'supermarket', osm_type: 'N', osm_id: 1, name: 'BILLA', street: 'Reinprechtsdorfer Straße', housenumber: '32', postcode: '1050', city: 'Wien' }, 16.3545, 48.1888),
      feature({ osm_key: 'amenity', osm_value: 'restaurant', name: 'Billa Bar' }, 16.355, 48.188),
      feature({ osm_key: 'shop', osm_value: 'supermarket', osm_id: 3, name: 'BILLA', city: 'Salzburg' }, 13.04, 47.8),
    ] }) };
  };
  const r = await PL.searchStores('billa', WIEN_1050, fake);
  assert.deepStrictEqual(r.map((s) => s.address), ['Reinprechtsdorfer Straße 32, 1050 Wien', 'Margaretenstraße 120, 1050 Wien']);
  assert.ok(r[0].km < r[1].km && r[0].km < 0.1);
  assert.strictEqual(r[0].osmId, '1');
});

test('Entfernung und Anzeige', () => {
  assert.ok(Math.abs(PL.distanceKm({ lat: 48.2082, lon: 16.3738 }, { lat: 47.0707, lon: 15.4395 }) - 145) < 3); // Wien–Graz
  assert.strictEqual(PL.formatDistance(0.34), '350 m');
  assert.strictEqual(PL.formatDistance(2.46), '2,5 km');
  assert.strictEqual(PL.formatDistance(NaN), '');
});

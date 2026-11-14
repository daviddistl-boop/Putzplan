/*
 * Putzplan – Orte und Märkte in der Nähe (OpenStreetMap über Photon).
 *
 * Photon (https://photon.komoot.io) ist eine freie Suche auf OpenStreetMap-Daten, die für
 * die Suche beim Tippen gedacht ist – anders als Nominatim, dessen Nutzungsregeln das
 * ausdrücklich verbieten. Fair nutzen: erst ab ein paar Zeichen und mit Verzögerung suchen.
 * Daten © OpenStreetMap-Mitwirkende (ODbL).
 *
 * Die Antworten werden tolerant gelesen; fehlt etwas, gibt es weniger Treffer, aber keinen Absturz.
 */
(function (root) {
  'use strict';

  const BASE = 'https://photon.komoot.io/api/';
  // Suchkasten um den Ort: so lange vergrößern, bis genug Filialen gefunden sind.
  const RADII_M = [2500, 7000, 20000];
  const ENOUGH = 6;
  const TIMEOUT_MS = 8000;
  const MAX_STORE_KM = 20;
  // Orts-Arten, die als „Dein Ort“ taugen (Bezirk, Stadt, Postleitzahl …).
  const PLACE_TYPES = ['city', 'town', 'village', 'district', 'locality', 'postcode', 'suburb', 'borough', 'county', 'hamlet'];

  const qs = (params) => Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  async function getJson(fetchFn, url) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
    try {
      const res = await fetchFn(url, { headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined });
      if (!res.ok) throw new Error(`Ortssuche antwortet mit ${res.status}`);
      return await res.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const features = (json) => (json && Array.isArray(json.features) ? json.features : []);
  const coords = (f) => {
    const c = f && f.geometry && f.geometry.coordinates;
    return Array.isArray(c) && c.length >= 2 ? { lon: Number(c[0]), lat: Number(c[1]) } : { lat: NaN, lon: NaN };
  };

  /** Entfernung in Kilometern (Haversine). */
  function distanceKm(a, b) {
    const rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  }

  function formatDistance(km) {
    if (!Number.isFinite(km)) return '';
    return km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)}\u00a0m` : `${km.toFixed(km < 10 ? 1 : 0).replace('.', ',')}\u00a0km`;
  }

  // Wiener Bezirke: Postleitzahl 1XX0 → XX. Bezirk.
  const VIENNA_DISTRICTS = ['Innere Stadt', 'Leopoldstadt', 'Landstraße', 'Wieden', 'Margareten', 'Mariahilf', 'Neubau',
    'Josefstadt', 'Alsergrund', 'Favoriten', 'Simmering', 'Meidling', 'Hietzing', 'Penzing', 'Rudolfsheim-Fünfhaus',
    'Ottakring', 'Hernals', 'Währing', 'Döbling', 'Brigittenau', 'Floridsdorf', 'Donaustadt', 'Liesing'];

  const isPostcodePlace = (p) => p.type === 'postcode' || p.osm_value === 'postcode';
  const postcodeOf = (p) => p.postcode || (isPostcodePlace(p) && p.name ? String(p.name) : '');

  function districtOf(p, city) {
    const pc = postcodeOf(p);
    const m = /^1(\d\d)0$/.exec(pc);
    if (city === 'Wien' && m && Number(m[1]) >= 1 && Number(m[1]) <= 23) return VIENNA_DISTRICTS[Number(m[1]) - 1];
    // „Katastralgemeinde Margarethen“ → „Margarethen“
    return String(p.district || p.locality || '').replace(/^Katastralgemeinde\s+/i, '');
  }

  /** „Wien, Margareten, 1050“ aus den Angaben eines Treffers. */
  function placeLabel(p) {
    const city = p.city || (['city', 'town', 'village'].includes(p.type || p.osm_value) ? p.name : null) || p.county || p.state;
    const part = districtOf(p, city) || (p.name && p.name !== city && !/^\d+$/.test(p.name) ? p.name : null);
    const parts = [city, part, postcodeOf(p)].filter(Boolean);
    return [...new Set(parts)].join(', ');
  }

  /** Ein Orts-Treffer → { label, city, district, postcode, country, lat, lon } oder null. */
  function normalizePlace(f) {
    const p = (f && f.properties) || {};
    const type = p.type || p.osm_value;
    if (!PLACE_TYPES.includes(type) && !(p.osm_key === 'place') && !(p.osm_key === 'boundary' && p.postcode)) return null;
    const { lat, lon } = coords(f);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const label = placeLabel(p);
    if (!label) return null;
    return {
      label,
      city: p.city || (['city', 'town', 'village'].includes(type) ? p.name : '') || '',
      district: districtOf(p, p.city || ''),
      postcode: postcodeOf(p),
      country: String(p.countrycode || '').toUpperCase(),
      lat,
      lon,
    };
  }

  /** Ort suchen: „1050“, „Margareten“, „Graz“ … `country` filtert auf ein Land (z. B. AT). */
  async function searchPlaces(query, opts, fetchFn) {
    const q = String(query || '').trim();
    if (q.length < 2) return [];
    const o = opts || {};
    const f = fetchFn || root.fetch.bind(root);
    const json = await getJson(f, `${BASE}?${qs({ q, lang: 'de', limit: 10 })}`);
    const seen = new Set();
    return features(json).map(normalizePlace).filter((p) => {
      if (!p || (o.country && p.country && p.country !== o.country)) return false;
      if (seen.has(p.label)) return false;
      seen.add(p.label);
      return true;
    }).slice(0, 6);
  }

  /**
   * Postleitzahl und Bezirk zu Koordinaten (Rückwärtssuche) → { label, city, district, postcode, country }
   * oder null. Repariert früher gespeicherte Orte ohne Postleitzahl.
   */
  async function reversePlace(lat, lon, fetchFn) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const f = fetchFn || root.fetch.bind(root);
    const json = await getJson(f, `${BASE.replace(/api\/$/, 'reverse')}?${qs({ lat, lon, lang: 'de', limit: 1 })}`);
    const p = (features(json)[0] || {}).properties;
    if (!p || !postcodeOf(p)) return null;
    const city = p.city || p.county || p.state || '';
    return { label: placeLabel(Object.assign({}, p, { name: isPostcodePlace(p) ? p.name : '' })), city, district: districtOf(p, city), postcode: postcodeOf(p), country: String(p.countrycode || '').toUpperCase() };
  }

  /** Adresse einer Filiale: „Reinprechtsdorfer Straße 32, 1050 Wien“. */
  function formatAddress(s) {
    const street = [s.street, s.housenumber].filter(Boolean).join(' ');
    const town = [s.postcode, s.city].filter(Boolean).join(' ');
    return [street, town].filter(Boolean).join(', ');
  }

  /** Ein Markt-Treffer → { name, street, housenumber, postcode, city, address, lat, lon, osmId, osmType, km } oder null. */
  function normalizeStore(f, near) {
    const p = (f && f.properties) || {};
    if (p.osm_key !== 'shop' || !p.name) return null;
    const { lat, lon } = coords(f);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const s = {
      name: String(p.name).trim(),
      kind: p.osm_value || '',
      street: p.street || '',
      housenumber: p.housenumber || '',
      postcode: p.postcode || '',
      city: p.city || '',
      lat,
      lon,
      osmId: p.osm_id != null ? String(p.osm_id) : null,
      osmType: p.osm_type || null,
    };
    s.address = formatAddress(s);
    s.km = near && Number.isFinite(near.lat) ? distanceKm(near, s) : NaN;
    return s;
  }

  /**
   * Reihenfolge: zuerst Filialen mit der Postleitzahl des eigenen Ortes, dann nach Entfernung.
   * Doppelte (gleiche OSM-Kennung oder gleicher Name an gleicher Adresse) fliegen raus.
   */
  function sortStores(list, near, limit) {
    const pc = near && near.postcode ? String(near.postcode) : '';
    const seen = new Set();
    return list
      .filter((s) => {
        if (!s || !(s.km <= MAX_STORE_KM)) return false;
        const k = s.osmId ? `${s.osmType}${s.osmId}` : `${s.name}|${s.address}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((s) => Object.assign(s, { samePostcode: !!(pc && s.postcode === pc) }))
      .sort((a, b) => (b.samePostcode - a.samePostcode) || (a.km - b.km))
      .slice(0, limit || 25);
  }

  // Photon nur innerhalb eines Kastens um den Ort (bbox) und nur Geschäfte – so kommen die
  // Filialen in der Nähe, nicht die „bekanntesten“ irgendwo.
  function bboxAround(near, radius) {
    const dLat = radius / 111320;
    const dLon = dLat / Math.max(0.2, Math.cos((near.lat * Math.PI) / 180));
    return [near.lon - dLon, near.lat - dLat, near.lon + dLon, near.lat + dLat].map((x) => x.toFixed(5)).join(',');
  }

  async function photonAround(q, near, radius, f) {
    const url = `${BASE}?${qs({ q, lat: near.lat, lon: near.lon, bbox: bboxAround(near, radius), osm_tag: 'shop', lang: 'de', limit: 50 })}`;
    return features(await getJson(f, url)).map((x) => normalizeStore(x, near)).filter(Boolean);
  }

  /**
   * Märkte in der Nähe eines Ortes suchen, z. B. „Billa“: nur Geschäfte, höchstens
   * MAX_STORE_KM entfernt, Filialen im eigenen Postleitzahl-Gebiet zuerst, dann die nächsten.
   * Gesucht wird im Kasten von ±2,5 km, dann ±7 km, dann ±20 km um den Ort.
   */
  async function searchStores(query, near, fetchFn) {
    const q = String(query || '').trim();
    if (q.length < 2 || !near || !Number.isFinite(near.lat) || !Number.isFinite(near.lon)) return [];
    const f = fetchFn || root.fetch.bind(root);
    let list = [];
    for (const radius of RADII_M) {
      list = sortStores(list.concat(await photonAround(q, near, radius, f)), near, 100);
      if (list.length >= ENOUGH) break;
    }
    return sortStores(list, near);
  }

  const api = { BASE, MAX_STORE_KM, bboxAround, sortStores, distanceKm, formatDistance, placeLabel, normalizePlace, searchPlaces, reversePlace, formatAddress, normalizeStore, searchStores };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Places = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

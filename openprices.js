/*
 * Putzplan – Anbindung an Open Prices (Open Food Facts).
 * Lesen geht ohne Konto. Eigene Preise teilen nur auf ausdrücklichen Wunsch, mit einem
 * eigenen Open-Food-Facts-Konto und einem Foto vom Preisschild als Beleg.
 *
 * Open Prices ist eine offene, gemeinschaftlich gepflegte Preisdatenbank
 * (https://prices.openfoodfacts.org, Daten unter ODbL). Preise gehören dort zu einem
 * Produkt mit Strichcode – oder bei Obst & Gemüse zu einer Kategorie wie „en:bananas“.
 * Für einen Artikel der Einkaufsliste suchen wir deshalb passende Produkte per Name
 * (bzw. die Kategorie) und holen deren jüngste Preise.
 *
 * Die Antworten werden bewusst tolerant gelesen: Fehlt ein Feld oder ändert sich die
 * Schnittstelle, gibt es weniger Treffer, aber keinen Absturz.
 */
(function (root) {
  'use strict';

  const BASE = 'https://prices.openfoodfacts.org/api/v1';
  const TIMEOUT_MS = 10000;

  // Obst & Gemüse ohne Strichcode: Katalog-Schlüssel → Kategorie in Open Prices.
  const CATEGORY_TAGS = {
    aepfel: 'en:apples', bananen: 'en:bananas', birnen: 'en:pears', orangen: 'en:oranges', zitronen: 'en:lemons',
    limetten: 'en:limes', trauben: 'en:grapes', erdbeeren: 'en:strawberries', heidelbeeren: 'en:blueberries',
    kiwis: 'en:kiwifruits', ananas: 'en:pineapples', mango: 'en:mangoes', avocado: 'en:avocados',
    tomaten: 'en:tomatoes', gurke: 'en:cucumbers', paprika: 'en:bell-peppers', karotten: 'en:carrots',
    kartoffeln: 'en:potatoes', zwiebeln: 'en:onions', knoblauch: 'en:garlic', zucchini: 'en:zucchini',
    brokkoli: 'en:broccoli', blumenkohl: 'en:cauliflowers', champignons: 'en:button-mushrooms', ingwer: 'en:ginger',
    'suesskartoffeln': 'en:sweet-potatoes', aubergine: 'en:aubergines', salat: 'en:lettuces',
  };

  const num = (x) => (x === null || x === undefined || x === '' ? NaN : Number(x));

  /** Ein Preis-Eintrag der Schnittstelle → einheitliche Form, oder null. */
  function normalizePrice(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const price = num(raw.price);
    if (!(price > 0)) return null;
    const product = raw.product || {};
    const loc = raw.location || {};
    const display = String(loc.osm_display_name || '');
    const store = loc.osm_brand || loc.osm_name || display.split(',')[0].trim() || null;
    const qty = num(product.product_quantity);
    const unit = product.product_quantity_unit || (Number.isFinite(qty) ? 'g' : '');
    return {
      cents: Math.round(price * 100),
      currency: String(raw.currency || '').toUpperCase(),
      per: raw.price_per || null, // z. B. KILOGRAM oder UNIT bei Obst & Gemüse
      discounted: !!raw.price_is_discounted,
      date: raw.date || null,
      product: product.product_name || raw.product_name || null,
      brand: product.brands || null,
      quantity: Number.isFinite(qty) && qty > 0 ? `${qty} ${unit}`.trim() : null,
      code: raw.product_code || product.code || null,
      store,
      city: loc.osm_address_city || null,
      osmId: loc.osm_id != null ? String(loc.osm_id) : (raw.location_osm_id != null ? String(raw.location_osm_id) : null),
      country: String(loc.osm_address_country_code || '').toUpperCase() || null,
    };
  }

  /**
   * Filtert und sortiert: nur Euro, nur das gewünschte Land (falls bekannt), Treffer aus
   * dem eigenen Ort zuerst, dann die jüngsten. Höchstens `limit`.
   */
  function rank(prices, opts) {
    const o = opts || {};
    const country = String(o.country || '').toUpperCase();
    const city = String(o.city || '').trim().toLowerCase();
    return prices
      .filter((p) => p && (!p.currency || p.currency === 'EUR'))
      .filter((p) => !country || !p.country || p.country === country)
      .map((p) => ({ p, local: !!(city && p.city && p.city.toLowerCase().includes(city)) }))
      .sort((a, b) => (b.local - a.local) || String(b.p.date || '').localeCompare(String(a.p.date || '')))
      .slice(0, o.limit || 15)
      .map((x) => Object.assign({ local: x.local }, x.p));
  }

  function items(json) {
    if (Array.isArray(json)) return json;
    return (json && (json.items || json.results)) || [];
  }

  async function getJson(fetchFn, url) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
    try {
      const res = await fetchFn(url, { headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined });
      if (!res.ok) throw new Error(`Open Prices antwortet mit ${res.status}`);
      return await res.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const qs = (params) => Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  /**
   * Preise zu einem Einkaufsartikel suchen. `item` = { name, key }, `opts` = { country, city }.
   * Gibt eine sortierte Liste einheitlicher Preise zurück (leer, wenn nichts gefunden).
   */
  async function search(item, opts, fetchFn) {
    const f = fetchFn || root.fetch.bind(root);
    const tag = item.key && CATEGORY_TAGS[item.key];
    let raw = [];
    if (tag) {
      raw = items(await getJson(f, `${BASE}/prices?${qs({ category_tag: tag, currency: 'EUR', order_by: '-date', size: 50 })}`));
    }
    if (!raw.length) {
      const products = items(await getJson(f, `${BASE}/products?${qs({ product_name__like: item.name, order_by: '-price_count', size: 8 })}`));
      const codes = products.map((p) => p && (p.code || p.product_code)).filter(Boolean).slice(0, 4);
      const lists = await Promise.all(codes.map((code) => getJson(f, `${BASE}/prices?${qs({ product_code: code, order_by: '-date', size: 20 })}`)
        .then(items).catch(() => [])));
      raw = [].concat(...lists);
    }
    return rank(raw.map(normalizePrice).filter(Boolean), opts);
  }

  // ------------------------------------------------------------ Produkt per Barcode

  /** Nur Ziffern; gültige EAN-8/12/13/14-Länge, sonst null. */
  function cleanCode(code) {
    const c = String(code == null ? '' : code).replace(/\D/g, '');
    return [8, 12, 13, 14].includes(c.length) ? c : null;
  }

  /**
   * Produkt zu einem Barcode: { code, name, brand, quantity, image } oder null (unbekannt).
   * `name` ist schon „Marke Produkt“, z. B. „Wasa Fibres“.
   */
  async function product(code, fetchFn) {
    const c = cleanCode(code);
    if (!c) return null;
    const f = fetchFn || root.fetch.bind(root);
    const res = await f(`${BASE}/products/code/${c}`, { headers: { Accept: 'application/json' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Open Prices antwortet mit ${res.status}`);
    const p = await res.json();
    const brand = String(p.brands || '').split(',')[0].trim();
    const prettyBrand = brand && brand === brand.toLowerCase() ? brand.charAt(0).toUpperCase() + brand.slice(1) : brand;
    const pname = String(p.product_name || '').trim();
    const name = pname && prettyBrand && !pname.toLowerCase().includes(prettyBrand.toLowerCase()) ? `${prettyBrand} ${pname}` : (pname || prettyBrand);
    const q = num(p.product_quantity);
    const quantity = Number.isFinite(q) && q > 0 ? `${q} ${p.product_quantity_unit || 'g'}` : (p.quantity || null);
    return { code: c, name: name.slice(0, 40), brand: prettyBrand || null, quantity, image: p.image_url || null };
  }

  // ------------------------------------------------------------ Preise teilen (mit Konto)

  const OSM_TYPES = { N: 'NODE', W: 'WAY', R: 'RELATION', NODE: 'NODE', WAY: 'WAY', RELATION: 'RELATION' };
  const osmType = (t) => OSM_TYPES[String(t || '').toUpperCase()] || null;

  async function call(f, path, init) {
    const res = await f(`${BASE}${path}`, init);
    let body = null;
    try { body = await res.json(); } catch (e) { /* kein JSON */ }
    if (!res.ok) {
      const err = new Error((body && (body.detail || body.message)) ? String(body.detail || body.message) : `Open Prices antwortet mit ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  /**
   * Anmelden mit Open-Food-Facts-Benutzername (nicht E-Mail) und Passwort → { user, token }.
   * Das Passwort wird nur hierfür gesendet und nicht gespeichert.
   */
  async function login(username, password, fetchFn) {
    const f = fetchFn || root.fetch.bind(root);
    const body = await call(f, '/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: qs({ username: String(username || '').trim(), password: String(password || '') }),
    });
    if (!body || !body.access_token) throw new Error('Anmeldung fehlgeschlagen');
    return { user: body.user_id || String(username).trim(), token: body.access_token };
  }

  /** Datum „2026-11-17“ in Ortszeit. */
  function isoDate(t) {
    const d = new Date(t || Date.now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * Preis teilen: erst das Foto als Beleg (Preisschild) hochladen, dann den Preis.
   * `data` = { token, code, cents, discounted, osmId, osmType, at, photo (Blob), fileName }.
   * Gibt { proofId, priceId } zurück.
   */
  async function sharePrice(data, fetchFn) {
    const f = fetchFn || root.fetch.bind(root);
    const code = cleanCode(data.code);
    const type = osmType(data.osmType);
    if (!data.token) throw new Error('Nicht bei Open Prices angemeldet');
    if (!code) throw new Error('Kein gültiger Barcode');
    if (!data.osmId || !type) throw new Error('Markt ohne OpenStreetMap-Filiale');
    if (!data.photo) throw new Error('Foto vom Preisschild fehlt');
    const auth = { Authorization: `Bearer ${data.token}`, Accept: 'application/json' };
    const date = isoDate(data.at);
    const form = new root.FormData();
    form.append('file', data.photo, data.fileName || 'preisschild.jpg');
    form.append('type', 'PRICE_TAG');
    form.append('location_osm_id', String(data.osmId));
    form.append('location_osm_type', type);
    form.append('currency', 'EUR');
    form.append('date', date);
    const proof = await call(f, '/proofs/upload', { method: 'POST', headers: auth, body: form });
    if (!proof || proof.id == null) throw new Error('Beleg wurde nicht angenommen');
    const price = await call(f, '/prices', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
      body: JSON.stringify({
        type: 'PRODUCT',
        product_code: code,
        price: Math.round(data.cents) / 100,
        price_is_discounted: !!data.discounted,
        currency: 'EUR',
        date,
        location_osm_id: Number(data.osmId),
        location_osm_type: type,
        proof_id: proof.id,
      }),
    });
    return { proofId: proof.id, priceId: price && price.id != null ? price.id : null };
  }

  const api = { BASE, CATEGORY_TAGS, normalizePrice, rank, search, cleanCode, product, login, sharePrice, isoDate, osmType };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenPrices = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/*
 * Putzplan – Anbindung an Open Prices (Open Food Facts), nur lesend und ohne Konto.
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

  const api = { BASE, CATEGORY_TAGS, normalizePrice, rank, search };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenPrices = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

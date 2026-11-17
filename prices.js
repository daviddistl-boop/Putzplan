/*
 * Putzplan – Preisgedächtnis für die Einkaufsliste.
 *
 * Reine Logik ohne Oberfläche: Märkte, gemerkte Preise je Artikel und Markt, und der
 * Vergleich, wo der Einkauf am günstigsten ist. Preise werden in Cent gespeichert.
 * Ein Artikel wird über seinen Preis-Schlüssel erkannt: Katalog-Schlüssel oder
 * „n:“ + normalisierter Name bei eigenen Artikeln.
 */
(function (root) {
  'use strict';

  const DAY = 86400000;
  const KEEP_PER_STORE = 6; // so viele Preise je Artikel und Markt bleiben gespeichert
  const MAX_AGE_DAYS = 365; // ältere Preise werden aufgeräumt
  const FRESH_DAYS = 120; // für den „üblichen“ Preis zählen nur jüngere Preise
  const STALE_DAYS = 60; // danach gilt ein Preis als „alt“

  // Häufige Märkte zum schnellen Anlegen, je Land.
  const STORE_PRESETS_BY_COUNTRY = {
    DE: ['Aldi Süd', 'Aldi Nord', 'Lidl', 'Rewe', 'Edeka', 'Kaufland', 'Penny', 'Netto', 'Norma', 'Globus', 'dm', 'Rossmann', 'Müller'],
    AT: ['Billa', 'Billa Plus', 'Spar', 'Eurospar', 'Interspar', 'Hofer', 'Lidl', 'Penny', 'MPreis', 'Unimarkt', 'dm', 'Bipa', 'Müller'],
  };
  const STORE_PRESETS = STORE_PRESETS_BY_COUNTRY.DE.concat(['Hofer', 'Billa', 'Spar']);
  const storePresets = (country) => STORE_PRESETS_BY_COUNTRY[country] || STORE_PRESETS;

  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/\s+/g, ' ').trim();
  }

  /** Schlüssel, unter dem Preise eines Einkaufsartikels gemerkt werden. */
  function priceKey(item) {
    return item.key || `n:${norm(item.name)}`;
  }

  /** „1,79“, „1.79 €“, „2“ → Cent. Ungültig → null. */
  function parseEuro(input) {
    const s = String(input == null ? '' : input).replace(/€|eur(o)?/gi, '').replace(/\s/g, '');
    if (!/^\d{1,4}([.,]\d{1,2})?$/.test(s)) return null;
    const [eur, ct = ''] = s.replace(',', '.').split('.');
    const cents = Number(eur) * 100 + Number((ct + '00').slice(0, 2));
    return cents > 0 && cents <= 999999 ? cents : null;
  }

  function formatEuro(cents) {
    if (cents == null) return '';
    return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
  }

  /** Neuen Preis merken; räumt alte und überzählige Einträge auf. Gibt die neue Liste zurück. */
  function addPrice(prices, entry, now) {
    const t = now || Date.now();
    const list = (prices || []).concat(entry);
    const minAt = t - MAX_AGE_DAYS * DAY;
    const groups = new Map();
    for (const p of list) {
      if (!p || !p.cents || (p.at || 0) < minAt) continue;
      const g = `${p.key}|${p.storeId}|${p.variantId || ''}`; // je Sorte eigene Liste
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(p);
    }
    const out = [];
    for (const g of groups.values()) {
      g.sort((a, b) => (b.at || 0) - (a.at || 0));
      out.push(...g.slice(0, KEEP_PER_STORE));
    }
    return out;
  }

  /**
   * Üblicher Preis eines Artikels in einem Markt: Mittelwert der letzten (höchstens 3)
   * Preise der letzten FRESH_DAYS Tage – Aktionen schlagen so nicht voll durch. Gibt es nur
   * ältere, zählt der jüngste. { cents, at, n, stale } oder null.
   */
  function storePrice(prices, key, storeId, now) {
    const t = now || Date.now();
    const mine = (prices || []).filter((p) => p.key === key && p.storeId === storeId).sort((a, b) => b.at - a.at);
    if (!mine.length) return null;
    const fresh = mine.filter((p) => t - p.at <= FRESH_DAYS * DAY).slice(0, 3);
    const use = fresh.length ? fresh : [mine[0]];
    const sorted = use.map((p) => p.cents).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return { cents: median, at: mine[0].at, n: mine.length, stale: t - mine[0].at > STALE_DAYS * DAY };
  }

  // ------------------------------------------------------------ Mengen & Grundpreis

  // Einheiten → Grundeinheit (kg, l, Stk) und Faktor.
  const UNITS = {
    g: ['kg', 0.001], gr: ['kg', 0.001], gramm: ['kg', 0.001], kg: ['kg', 1], kilo: ['kg', 1],
    ml: ['l', 0.001], cl: ['l', 0.01], dl: ['l', 0.1], l: ['l', 1], liter: ['l', 1], ltr: ['l', 1],
    stk: ['Stk', 1], 'stück': ['Stk', 1], stueck: ['Stk', 1], st: ['Stk', 1], x: ['Stk', 1],
    rolle: ['Stk', 1], rollen: ['Stk', 1], tabs: ['Stk', 1], 'wl': ['Stk', 1],
  };

  /**
   * Mengenangabe lesen: „275 g“, „1,5l“, „6 x 0,5 l“, „10 Stk“, „500ml“ →
   * { amount, base } in Grundeinheit (0.275 kg, 1.5 l, 3 l, 10 Stk). Ungültig → null.
   */
  function parseQty(input) {
    const s = String(input == null ? '' : input).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!s) return null;
    const num = (x) => Number(String(x).replace(',', '.'));
    const m = /^(?:(\d+)\s*[x×*]\s*)?(\d+(?:[.,]\d+)?)\s*([a-zäöü]+)\.?$/.exec(s);
    if (!m) return null;
    const u = UNITS[m[3]];
    if (!u) return null;
    const amount = (m[1] ? Number(m[1]) : 1) * num(m[2]) * u[1];
    return amount > 0 && amount < 100000 ? { amount: Math.round(amount * 100000) / 100000, base: u[0] } : null;
  }

  /** { amount: 0.275, base: 'kg' } → „275 g“; 1.5 l → „1,5 l“; 10 Stk → „10 Stk“. */
  function formatQty(q) {
    if (!q || !q.amount) return '';
    const n = (x) => String(Math.round(x * 1000) / 1000).replace('.', ',');
    if (q.base === 'kg') return q.amount < 1 ? `${n(q.amount * 1000)} g` : `${n(q.amount)} kg`;
    if (q.base === 'l') return q.amount < 1 ? `${n(q.amount * 1000)} ml` : `${n(q.amount)} l`;
    return `${n(q.amount)} Stk`;
  }

  /** Grundpreis in Cent je kg / l / Stk. */
  const unitCents = (cents, qty) => (qty && qty.amount ? cents / qty.amount : null);

  /** „6,51 €/kg“ */
  function formatUnitPrice(cents, qty) {
    const u = unitCents(cents, qty);
    return u == null ? '' : `${formatEuro(Math.round(u))}/${qty.base}`;
  }

  // ------------------------------------------------------------ Sorten

  /**
   * Preise für einen Artikel mit Sorten. `item` = { key, variantId } (variantId leer = „egal welche“),
   * `variants` = Sorten dieses Artikels [{ id, name, qty }]. Ergebnis je Markt:
   * { cents, at, stale, n, variantId, qty, unit } – bei „egal welche“ die Sorte mit dem
   * günstigsten Grundpreis; `cents` ist dann auf die übliche Packungsgröße (`refQty`)
   * umgerechnet, damit Märkte mit verschieden großen Packungen fair verglichen werden.
   */
  function itemOffer(prices, item, variants, storeId, now, refQty) {
    const vs = variants || [];
    const byVariant = (vid) => storePrice((prices || []).filter((p) => (p.variantId || null) === vid), item.key, storeId, now);
    const qtyOf = (vid) => { const v = vs.find((x) => x.id === vid); return v ? v.qty || null : null; };
    if (item.variantId) {
      const pr = byVariant(item.variantId);
      if (!pr) return null;
      const qty = qtyOf(item.variantId);
      return Object.assign({}, pr, { variantId: item.variantId, qty, unit: unitCents(pr.cents, qty) });
    }
    const cands = [null].concat(vs.map((v) => v.id)).map((vid) => {
      const pr = byVariant(vid);
      if (!pr) return null;
      const qty = qtyOf(vid);
      return Object.assign({}, pr, { variantId: vid, qty, unit: unitCents(pr.cents, qty) });
    }).filter(Boolean);
    if (!cands.length) return null;
    const withUnit = cands.filter((c) => c.unit != null && (!refQty || c.qty.base === refQty.base));
    if (withUnit.length) {
      const best = withUnit.sort((a, b) => a.unit - b.unit)[0];
      return refQty ? Object.assign({}, best, { cents: Math.round(best.unit * refQty.amount), packCents: best.cents }) : best;
    }
    return cands.sort((a, b) => a.cents - b.cents)[0];
  }

  /** Übliche Packungsgröße eines Artikels: Menge der zuletzt mit Preis gemerkten Sorte. */
  function usualQty(prices, key, variants) {
    const vs = variants || [];
    const last = (prices || []).filter((p) => p.key === key && p.variantId && vs.some((v) => v.id === p.variantId && v.qty))
      .sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    return last ? vs.find((v) => v.id === last.variantId).qty : null;
  }

  /** Alle Märkte mit Preis für einen Artikel, günstigster zuerst. `prices` darf auch ein Auflöser (key, storeId) → Preis sein. */
  function compareItem(prices, key, storeIds, now) {
    const priceOf = resolver(prices, now);
    return storeIds.map((storeId) => ({ storeId, price: priceOf(key, storeId) }))
      .filter((x) => x.price)
      .sort((a, b) => a.price.cents - b.price.cents);
  }

  const resolver = (prices, now) => (typeof prices === 'function' ? prices : (key, storeId) => storePrice(prices, key, storeId, now));

  /**
   * Vergleich für eine ganze Einkaufsliste.
   *  - perStore: je Markt Summe der bekannten Preise und welche Artikel fehlen.
   *  - common: Summen nur über Artikel, die in ALLEN verglichenen Märkten einen Preis haben
   *    (fairer Vergleich); `best` ist dort der günstigste Markt.
   *  - split: günstigster Markt je Artikel und die Ersparnis gegenüber `best`.
   * `keys` = Preis-Schlüssel der offenen Artikel.
   */
  function basket(prices, keys, storeIds, now) {
    const priceOf = resolver(prices, now);
    const perStore = storeIds.map((storeId) => {
      let total = 0;
      const known = [];
      const missing = [];
      for (const key of keys) {
        const p = priceOf(key, storeId);
        if (p) { total += p.cents; known.push(key); } else missing.push(key);
      }
      return { storeId, total, known, missing };
    }).filter((s) => s.known.length);

    const compared = perStore.map((s) => s.storeId);
    const commonKeys = compared.length >= 2 ? keys.filter((k) => perStore.every((s) => s.known.includes(k))) : [];
    const common = compared.map((storeId) => ({
      storeId,
      total: commonKeys.reduce((sum, k) => sum + priceOf(k, storeId).cents, 0),
    })).sort((a, b) => a.total - b.total);

    let split = null;
    if (commonKeys.length && common.length >= 2) {
      const choice = commonKeys.map((k) => compareItem(priceOf, k, compared)[0]);
      const total = choice.reduce((sum, c) => sum + c.price.cents, 0);
      const stores = [...new Set(choice.map((c) => c.storeId))];
      split = { total, stores, saving: common[0].total - total };
    }
    return {
      perStore,
      commonKeys,
      common,
      best: common.length >= 2 && commonKeys.length ? common[0] : null,
      split,
    };
  }

  /**
   * Preise pro Kette statt pro Filiale: In Österreich haben Billa, Spar, Hofer & Co. praktisch
   * überall dieselben Preise. Gibt eine Zuordnung Markt-ID → Ketten-ID (erste Filiale gleichen
   * Namens) zurück und die Liste der Ketten-IDs.
   */
  function chains(stores) {
    const first = new Map();
    const of = {};
    for (const s of stores || []) {
      const n = norm(s.name);
      if (!first.has(n)) first.set(n, s.id);
      of[s.id] = first.get(n);
    }
    return { of, ids: [...first.values()] };
  }

  /** Preise auf Ketten umschreiben (storeId → Ketten-ID); unbekannte Märkte bleiben. */
  const pricesByChain = (prices, chainMap) => (prices || []).map((p) => (chainMap.of[p.storeId] && chainMap.of[p.storeId] !== p.storeId ? Object.assign({}, p, { storeId: chainMap.of[p.storeId] }) : p));

  const api = { STORE_PRESETS, STORE_PRESETS_BY_COUNTRY, storePresets, KEEP_PER_STORE, FRESH_DAYS, STALE_DAYS, norm, priceKey, parseEuro, formatEuro, addPrice, storePrice, compareItem, basket,
    parseQty, formatQty, unitCents, formatUnitPrice, itemOffer, usualQty, chains, pricesByChain };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Prices = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

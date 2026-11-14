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

  // Häufige Märkte zum schnellen Anlegen (Deutschland und Österreich).
  const STORE_PRESETS = ['Aldi Süd', 'Aldi Nord', 'Lidl', 'Rewe', 'Edeka', 'Kaufland', 'Penny', 'Netto', 'Norma', 'Globus',
    'dm', 'Rossmann', 'Müller', 'Hofer', 'Billa', 'Spar'];

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
      const g = `${p.key}|${p.storeId}`;
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

  /** Alle Märkte mit Preis für einen Artikel, günstigster zuerst. */
  function compareItem(prices, key, storeIds, now) {
    return storeIds.map((storeId) => ({ storeId, price: storePrice(prices, key, storeId, now) }))
      .filter((x) => x.price)
      .sort((a, b) => a.price.cents - b.price.cents);
  }

  /**
   * Vergleich für eine ganze Einkaufsliste.
   *  - perStore: je Markt Summe der bekannten Preise und welche Artikel fehlen.
   *  - common: Summen nur über Artikel, die in ALLEN verglichenen Märkten einen Preis haben
   *    (fairer Vergleich); `best` ist dort der günstigste Markt.
   *  - split: günstigster Markt je Artikel und die Ersparnis gegenüber `best`.
   * `keys` = Preis-Schlüssel der offenen Artikel.
   */
  function basket(prices, keys, storeIds, now) {
    const perStore = storeIds.map((storeId) => {
      let total = 0;
      const known = [];
      const missing = [];
      for (const key of keys) {
        const p = storePrice(prices, key, storeId, now);
        if (p) { total += p.cents; known.push(key); } else missing.push(key);
      }
      return { storeId, total, known, missing };
    }).filter((s) => s.known.length);

    const compared = perStore.map((s) => s.storeId);
    const commonKeys = compared.length >= 2 ? keys.filter((k) => perStore.every((s) => s.known.includes(k))) : [];
    const common = compared.map((storeId) => ({
      storeId,
      total: commonKeys.reduce((sum, k) => sum + storePrice(prices, k, storeId, now).cents, 0),
    })).sort((a, b) => a.total - b.total);

    let split = null;
    if (commonKeys.length && common.length >= 2) {
      const choice = commonKeys.map((k) => compareItem(prices, k, compared, now)[0]);
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

  const api = { STORE_PRESETS, KEEP_PER_STORE, FRESH_DAYS, STALE_DAYS, norm, priceKey, parseEuro, formatEuro, addPrice, storePrice, compareItem, basket };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Prices = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

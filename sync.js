/*
 * Putzplan – Abgleich zwischen Geräten (reine Logik, ohne Netzwerk).
 *
 * Der Zustand eines Haushalts wird in einzelne Datensätze zerlegt („Art:ID“ → JSON):
 * jeder Raum, jede Aufgabe, jede Pflanze, jedes Mitglied, jeder Verlaufseintrag und die
 * gemeinsamen Einstellungen. Hochgeladen wird nur, was sich seit dem letzten Abgleich
 * geändert hat (Vergleich mit dem „Schatten“ = Stand des Servers, wie das Gerät ihn kennt).
 *
 * Regeln bei gleichzeitigen Änderungen:
 *  - Je Datensatz gilt die zuletzt gespeicherte Fassung. Hat das Gerät selbst noch eine
 *    ungespeicherte Änderung, behält es sie und lädt sie gleich hoch.
 *  - Haken zwei Geräte dieselbe Aufgabe am selben Tag ab, zählt das erste Abhaken.
 *
 * Persönliches (laufender Timer, Erinnerungszeit, „Pflanzen im Plan“ …) wird nicht abgeglichen.
 */
(function (root) {
  'use strict';

  // Listen im Zustand und ihre Art im Abgleich. `ordered`: Reihenfolge wird mitgespeichert.
  const COLLECTIONS = [
    { key: 'rooms', kind: 'room', ordered: true },
    { key: 'members', kind: 'member', ordered: true },
    { key: 'plants', kind: 'plant', ordered: true },
    { key: 'tasks', kind: 'task' },
    { key: 'history', kind: 'history' },
    { key: 'shoppingLists', kind: 'list', ordered: true },
    { key: 'shoppingItems', kind: 'item' },
    { key: 'stores', kind: 'store', ordered: true },
    { key: 'prices', kind: 'price' },
  ];
  const SETTINGS_ID = 'main';
  // Persönliche Einstellungen: bleiben auf dem Gerät.
  const PERSONAL_SETTINGS = ['reminder', 'installHintDismissed', 'accountHintDismissed'];
  // Werte der Pflanzenaufgaben, die jedes Gerät selbst aus der Pflanze berechnet (Wetter, Datum).
  const PLANT_DERIVED = ['dueOn', 'name', 'note', 'interval', 'roomId'];

  const keyOf = (kind, id) => `${kind}:${id}`;
  const splitKey = (key) => {
    const i = key.indexOf(':');
    return [key.slice(0, i), key.slice(i + 1)];
  };

  function clone(x) {
    return x === undefined ? undefined : JSON.parse(JSON.stringify(x));
  }

  /** Gemeinsamer Teil der Einstellungen. */
  function sharedSettings(settings) {
    const s = clone(settings || {});
    for (const k of PERSONAL_SETTINGS) delete s[k];
    if (s.plants) delete s.plants.inPlan;
    return s;
  }

  /** Zerlegt den Zustand in Datensätze: Map „Art:ID“ → JSON-Text. */
  function stateToDocs(state) {
    const docs = new Map();
    for (const c of COLLECTIONS) {
      (state[c.key] || []).forEach((item, i) => {
        if (!item || item.id === undefined || item.id === null) return;
        let data = item;
        if (c.kind === 'task' && item.plantId) {
          data = Object.assign({}, item);
          for (const k of PLANT_DERIVED) delete data[k];
        }
        if (c.ordered) data = Object.assign({}, data, { _o: i });
        docs.set(keyOf(c.kind, String(item.id)), JSON.stringify(data));
      });
    }
    docs.set(keyOf('settings', SETTINGS_ID), JSON.stringify(sharedSettings(state.settings)));
    return docs;
  }

  /**
   * Baut den Zustand aus Datensätzen wieder auf. Persönliches und Nicht-Abgeglichenes
   * (Timer, persönliche Einstellungen) kommt aus `local`.
   */
  function docsToState(docs, local) {
    const out = Object.assign({}, local);
    for (const c of COLLECTIONS) {
      const items = [];
      for (const [key, json] of docs) {
        const [kind] = splitKey(key);
        if (kind !== c.kind || json === null) continue;
        items.push(JSON.parse(json));
      }
      if (c.ordered) items.sort((a, b) => (a._o ?? 0) - (b._o ?? 0) || String(a.id).localeCompare(String(b.id)));
      else if (c.kind === 'history') items.sort((a, b) => (a.day - b.day) || ((a.at || 0) - (b.at || 0)) || String(a.id).localeCompare(String(b.id)));
      else items.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      for (const it of items) delete it._o;
      // Berechnete Werte der Pflanzenaufgaben vom Gerät übernehmen (werden gleich neu berechnet).
      if (c.kind === 'task') {
        const prev = new Map((local.tasks || []).filter((t) => t.plantId).map((t) => [t.id, t]));
        for (const it of items) {
          if (!it.plantId) continue;
          const p = prev.get(it.id);
          for (const k of PLANT_DERIVED) if (p && p[k] !== undefined && it[k] === undefined) it[k] = p[k];
        }
      }
      out[c.key] = items;
    }
    const sj = docs.get(keyOf('settings', SETTINGS_ID));
    const shared = sj ? JSON.parse(sj) : {};
    const mine = local.settings || {};
    const settings = Object.assign({}, shared);
    for (const k of PERSONAL_SETTINGS) if (mine[k] !== undefined) settings[k] = mine[k];
    if (mine.plants && mine.plants.inPlan !== undefined) settings.plants = Object.assign({}, settings.plants, { inPlan: mine.plants.inPlan });
    if (!settings.minutesPerWeekday) settings.minutesPerWeekday = mine.minutesPerWeekday || [20, 20, 20, 20, 20, 60, 0];
    out.settings = settings;
    return out;
  }

  /**
   * Was muss hochgeladen werden? Vergleicht die Datensätze mit dem Schatten
   * (Objekt „Art:ID“ → JSON-Text oder null für gelöscht).
   */
  function diff(shadow, docs) {
    const upserts = [];
    const deletes = [];
    for (const [key, json] of docs) {
      if (shadow[key] !== json) upserts.push({ key, json });
    }
    for (const key of Object.keys(shadow)) {
      if (shadow[key] !== null && !docs.has(key)) deletes.push({ key });
    }
    return { upserts, deletes };
  }

  /**
   * Führt Änderungen vom Server ein. `rows` = [{ kind, id, data, deleted, updated_at }].
   * Ändert `docs` und `shadow` an Ort und Stelle; gibt den neuesten Zeitstempel zurück.
   */
  function applyRemote(docs, shadow, rows) {
    let cursor = null;
    let changed = false;
    for (const r of rows) {
      const key = keyOf(r.kind, r.id);
      const remote = r.deleted || r.data === null || r.data === undefined ? null : JSON.stringify(r.data);
      const local = docs.has(key) ? docs.get(key) : null;
      const base = Object.prototype.hasOwnProperty.call(shadow, key) ? shadow[key] : null;
      const pending = local !== base;
      shadow[key] = remote;
      if (!pending && local !== remote) {
        if (remote === null) docs.delete(key);
        else docs.set(key, remote);
        changed = true;
      }
      if (!cursor || r.updated_at > cursor) cursor = r.updated_at;
    }
    return { cursor, changed };
  }

  /**
   * Doppeltes Abhaken auflösen: Wurde dieselbe Aufgabe am selben Tag auf verschiedenen
   * Geräten erledigt, zählt das erste Abhaken. Entfernt die übrigen Einträge aus `history`
   * und gibt sie zurück.
   */
  function dedupeCompletions(history) {
    const groups = new Map();
    for (const h of history) {
      if (h.skipped) continue;
      const k = `${h.taskId}|${h.day}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(h);
    }
    const removed = new Set();
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => ((a.at || 0) - (b.at || 0)) || String(a.id).localeCompare(String(b.id)));
      const first = list[0];
      for (const h of list.slice(1)) {
        // Mehrfaches Abhaken auf demselben Gerät ist gewollt (z. B. zweimal gespült).
        if (h.dev && first.dev && h.dev === first.dev) continue;
        if (!h.dev && !first.dev) continue;
        removed.add(h);
      }
    }
    if (!removed.size) return [];
    const keep = history.filter((h) => !removed.has(h));
    history.length = 0;
    history.push(...keep);
    return [...removed];
  }

  /** Datensätze für den Upload: { kind, id, data, deleted }. */
  function toRows(changes) {
    return changes.upserts.map(({ key, json }) => {
      const [kind, id] = splitKey(key);
      return { kind, id, data: JSON.parse(json), deleted: false };
    }).concat(changes.deletes.map(({ key }) => {
      const [kind, id] = splitKey(key);
      return { kind, id, data: null, deleted: true };
    }));
  }

  const api = { COLLECTIONS, PERSONAL_SETTINGS, PLANT_DERIVED, keyOf, splitKey, sharedSettings, stateToDocs, docsToState, diff, applyRemote, dedupeCompletions, toRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PutzplanSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

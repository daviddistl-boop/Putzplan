/*
 * Putzplan – von App und Service Worker gemeinsam genutzt:
 *  - Kopie des App-Zustands in IndexedDB (der Service Worker kann kein localStorage lesen)
 *  - Text der täglichen Erinnerung
 */
(function (root) {
  'use strict';

  // Supabase-Projekt „Putzplan“. Der Publishable Key ist öffentlich – geschützt wird über die Zugriffsregeln der Datenbank.
  const SUPABASE_URL = 'https://nqopgnogbuidqtfwpsat.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_h9vDlRql-3T1gqvmiZbf9A_19rLtjG2';
  // Web-Client-ID aus der Google Cloud Console (öffentlich). Leer = Google-Anmeldung noch nicht eingerichtet.
  const GOOGLE_WEB_CLIENT_ID = '462887745840-dvvl62cu8l2ji34o4fag6ib26kphtkte.apps.googleusercontent.com';
  // Adresse der Supabase Edge Function für Push-Erinnerungen.
  const PUSH_API = `${SUPABASE_URL}/functions/v1/push`;
  // Pflanzenerkennung per Foto (Edge Function, fragt mit geheimem Schlüssel bei Pl@ntNet an).
  const PLANT_ID_API = `${SUPABASE_URL}/functions/v1/plant-id`;

  const DB_NAME = 'putzplan';
  const STORE = 'kv';

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function kv(mode, fn) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  const kvGet = (key) => kv('readonly', (s) => s.get(key));
  const kvSet = (key, value) => kv('readwrite', (s) => s.put(value, key));

  /** Titel und Text einer Erinnerung für einen Tag aus dem Plan. */
  function messageForDay(state, dayPlan, S) {
    if (!dayPlan.items.length) {
      return { title: 'Alles sauber ✨', body: 'Heute steht nichts auf deinem Putzplan.' };
    }
    const minutes = dayPlan.items.reduce((s, i) => s + S.estimate(i.task), 0);
    const rooms = new Map((state.rooms || []).map((r) => [r.id, r]));
    const names = dayPlan.items.slice(0, 4).map((i) => {
      const r = rooms.get(i.task.roomId);
      return `${r ? r.icon + ' ' : ''}${i.task.name}`;
    });
    const more = dayPlan.items.length - names.length;
    const n = dayPlan.items.length;
    return {
      title: `Heute: ${n} Aufgabe${n === 1 ? '' : 'n'} · ca. ${minutes} Min.`,
      body: names.join('\n') + (more > 0 ? `\n… und ${more} weitere` : ''),
    };
  }

  /** Erinnerungen für die nächsten `count` Tage (ab heute), jeweils mit dem geplanten Inhalt. */
  function reminderMessages(state, S, count) {
    const day = S.today();
    const done = (state.history || []).filter((h) => h.day === day && !h.skipped).map((h) => h.taskId);
    // Jedes Handy erinnert nur an die Aufgaben seiner Person (state.me), wenn es mehrere gibt.
    const me = state.me && (state.members || []).length > 1 ? state.me : null;
    return S.planDays(state, day, count, done).map((p) => {
      const mine = me ? Object.assign({}, p, { items: p.items.filter((i) => !i.memberId || i.memberId === me) }) : p;
      return Object.assign({ day: p.day }, messageForDay(state, mine, S));
    });
  }

  /** Titel und Text der Erinnerung für den heutigen Tag. */
  function reminderMessage(state, S) {
    return reminderMessages(state, S, 1)[0];
  }

  root.PutzplanShared = { SUPABASE_URL, SUPABASE_KEY, GOOGLE_WEB_CLIENT_ID, PUSH_API, PLANT_ID_API, kvGet, kvSet, reminderMessage, reminderMessages };
})(typeof self !== 'undefined' ? self : globalThis);

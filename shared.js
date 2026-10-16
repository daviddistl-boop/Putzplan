/*
 * Putzplan – von App und Service Worker gemeinsam genutzt:
 *  - Kopie des App-Zustands in IndexedDB (der Service Worker kann kein localStorage lesen)
 *  - Text der täglichen Erinnerung
 */
(function (root) {
  'use strict';

  // Adresse der Supabase Edge Function für Push-Erinnerungen.
  const PUSH_API = 'https://nqopgnogbuidqtfwpsat.supabase.co/functions/v1/push';

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

  /** Titel und Text der Erinnerung für den heutigen Tag. */
  function reminderMessage(state, S) {
    const day = S.today();
    const done = (state.history || []).filter((h) => h.day === day && !h.skipped).map((h) => h.taskId);
    const plan = S.planDays(state, day, 1, done)[0];
    if (!plan.items.length) {
      return { title: 'Alles sauber ✨', body: 'Heute steht nichts auf deinem Putzplan.' };
    }
    const minutes = plan.items.reduce((s, i) => s + i.task.minutes, 0);
    const rooms = new Map((state.rooms || []).map((r) => [r.id, r]));
    const names = plan.items.slice(0, 4).map((i) => {
      const r = rooms.get(i.task.roomId);
      return `${r ? r.icon + ' ' : ''}${i.task.name}`;
    });
    const more = plan.items.length - names.length;
    const n = plan.items.length;
    return {
      title: `Heute: ${n} Aufgabe${n === 1 ? '' : 'n'} · ca. ${minutes} Min.`,
      body: names.join('\n') + (more > 0 ? `\n… und ${more} weitere` : ''),
    };
  }

  root.PutzplanShared = { PUSH_API, kvGet, kvSet, reminderMessage };
})(typeof self !== 'undefined' ? self : globalThis);

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

  /** Titel und Text einer Erinnerung für einen Tag aus dem Plan. */
  function messageForDay(state, dayPlan) {
    if (!dayPlan.items.length) {
      return { title: 'Alles sauber ✨', body: 'Heute steht nichts auf deinem Putzplan.' };
    }
    const minutes = dayPlan.items.reduce((s, i) => s + i.task.minutes, 0);
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
    return S.planDays(state, day, count, done).map((p) => Object.assign({ day: p.day }, messageForDay(state, p)));
  }

  /** Titel und Text der Erinnerung für den heutigen Tag. */
  function reminderMessage(state, S) {
    return reminderMessages(state, S, 1)[0];
  }

  root.PutzplanShared = { PUSH_API, kvGet, kvSet, reminderMessage, reminderMessages };
})(typeof self !== 'undefined' ? self : globalThis);

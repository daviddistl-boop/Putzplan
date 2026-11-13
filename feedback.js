/*
 * Putzplan – Feedback, Anregungen und Fehlermeldungen.
 *
 * Reine Logik ohne Oberfläche und Netzwerk: Eingaben prüfen, den Datensatz bauen
 * und eine Warteschlange für Meldungen, die (noch) nicht gesendet werden konnten –
 * z. B. offline. Gesendet wird über cloud.js in die Supabase-Tabelle „feedback“.
 */
(function (root) {
  'use strict';

  const KINDS = [
    { key: 'idea', label: '💡 Anregung', placeholder: 'Was würde dir die App leichter machen?' },
    { key: 'bug', label: '🐞 Fehler', placeholder: 'Was ist passiert, und was hättest du erwartet? Wo in der App war das?' },
    { key: 'feedback', label: '💬 Feedback', placeholder: 'Was gefällt dir, was nicht?' },
  ];
  const MIN_LENGTH = 3;
  const MAX_LENGTH = 2000;
  const MAX_CONTACT = 200;
  const MAX_QUEUE = 20;
  const QUEUE_KEY = 'putzplan.feedbackQueue';

  /**
   * Baut den zu sendenden Datensatz oder liefert { error }.
   * `meta` (App-Version, Plattform, Seite …) wird nur bei includeMeta mitgeschickt –
   * die Putzplan-Daten selbst nie.
   */
  function build({ kind, message, contact, includeMeta, meta }) {
    const text = String(message || '').trim();
    if (!KINDS.some((k) => k.key === kind)) return { error: 'Bitte wähle aus, worum es geht.' };
    if (text.length < MIN_LENGTH) return { error: 'Schreib bitte ein paar Worte dazu.' };
    if (text.length > MAX_LENGTH) return { error: `Bitte höchstens ${MAX_LENGTH} Zeichen.` };
    const c = String(contact || '').trim();
    if (c.length > MAX_CONTACT) return { error: 'Die Kontaktangabe ist zu lang.' };
    const m = includeMeta && meta ? meta : {};
    return {
      row: {
        kind,
        message: text,
        contact: c || null,
        app_version: m.appVersion ? String(m.appVersion).slice(0, 40) : null,
        platform: m.platform ? String(m.platform).slice(0, 40) : null,
        context: includeMeta && meta ? { page: meta.page || null, screen: meta.screen || null, lang: meta.lang || null, at: meta.at || null } : null,
      },
    };
  }

  function readQueue(storage) {
    try {
      const q = JSON.parse(storage.getItem(QUEUE_KEY) || '[]');
      return Array.isArray(q) ? q : [];
    } catch (e) {
      return [];
    }
  }

  function writeQueue(storage, queue) {
    try { storage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE))); } catch (e) { /* Speicher voll */ }
  }

  function enqueue(storage, row) {
    writeQueue(storage, readQueue(storage).concat(row));
  }

  /**
   * Versucht alle gespeicherten Meldungen zu senden. Bricht beim ersten Fehler ab
   * (meist offline) und behält den Rest. Gibt die Zahl der gesendeten zurück.
   */
  async function flush(storage, send) {
    const queue = readQueue(storage);
    let sent = 0;
    while (sent < queue.length) {
      try {
        await send(queue[sent]);
      } catch (e) {
        break;
      }
      sent++;
      writeQueue(storage, queue.slice(sent));
    }
    return sent;
  }

  const api = { KINDS, MIN_LENGTH, MAX_LENGTH, QUEUE_KEY, build, readQueue, enqueue, flush };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PutzplanFeedback = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

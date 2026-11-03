/*
 * Putzplan – Planta-Verbindung: erkennt in Planta-Benachrichtigungen, welche
 * Pflanzenpflege ansteht. Planta hat keine offizielle Schnittstelle; die Android-App
 * liest deshalb (mit Erlaubnis) nur die Benachrichtigungen der Planta-App mit.
 */
(function (root) {
  'use strict';

  // Reihenfolge = Priorität, falls ein Text mehrere Stichwörter enthält.
  const ACTIONS = [
    { key: 'repot', name: '🪴 Pflanzen umtopfen', minutes: 20, re: /umtopf|topf.*wechsel|repot/i },
    { key: 'fertilize', name: '🌱 Pflanzen düngen', minutes: 10, re: /dünge|duenge|dünger|fertili[sz]/i },
    { key: 'mist', name: '💦 Pflanzen besprühen', minutes: 5, re: /besprüh|bespruh|sprüh|mist(ing)?\b/i },
    { key: 'clean', name: '🍃 Blätter abwischen', minutes: 10, re: /blätter.*(abwisch|reinig|putz)|abstaub|clean/i },
    { key: 'water', name: '💧 Pflanzen gießen', minutes: 5, re: /gie(ß|ss)|wässer|waesser|bewässer|wasser|water|durst|thirsty/i },
  ];

  /** Welche Pflege meint die Benachrichtigung? null = keine Pflegeaufgabe (z. B. Werbung). */
  function parse(title, text) {
    const all = `${title || ''}\n${text || ''}`;
    const action = ACTIONS.find((a) => a.re.test(all));
    if (!action) return null;
    return { key: action.key, name: action.name, minutes: action.minutes, note: (text || title || '').trim().slice(0, 160) };
  }

  const api = { ACTIONS, parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Planta = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

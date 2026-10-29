/*
 * Putzplan – Planungslogik
 *
 * Jede Aufgabe hat ein Intervall (in Tagen) und das Datum, an dem sie zuletzt
 * erledigt wurde. Daraus ergibt sich die "Verschmutzung": 0 = gerade geputzt,
 * 1 = heute fällig, >1 = überfällig.
 *
 * Der Wochenplan wird simuliert: Für jeden Tag werden die dringendsten Aufgaben
 * gewählt, bis das Zeitbudget des Tages voll ist. Was nicht passt, rutscht auf
 * den nächsten Tag. Bleibt Zeit übrig, werden bald fällige Aufgaben vorgezogen,
 * damit sich die Arbeit gleichmäßig verteilt.
 *
 * Datumswerte sind ganze Tageszahlen (Tage seit 1970-01-01, lokale Zeit).
 */
(function (root) {
  'use strict';

  const MS_PER_DAY = 86400000;
  // Ab dieser Verschmutzung darf eine Aufgabe vorgezogen werden.
  const PREFILL_THRESHOLD = 0.8;

  function dateToDay(date) {
    return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY);
  }

  function today() {
    return dateToDay(new Date());
  }

  function dayToDate(day) {
    const d = new Date(day * MS_PER_DAY);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  // 0 = Montag … 6 = Sonntag (1970-01-01 war ein Donnerstag).
  function weekday(day) {
    return (((day + 3) % 7) + 7) % 7;
  }

  /**
   * Folgeaufgaben (z. B. „Wäsche abnehmen“ nach „Wäsche aufhängen“) haben kein festes
   * Intervall: Sie werden fällig, wenn ihre Auslöser-Aufgabe erledigt wurde
   * (task.trigger = { afterTaskId, delayDays }, task.dueOn = Fälligkeitstag oder null).
   * Ab dem Fälligkeitstag sind sie dringender als alles andere.
   */
  function followUpUrgency(dueOn, day) {
    if (dueOn === null || dueOn === undefined || day < dueOn) return 0;
    return 2 + (day - dueOn);
  }

  // ------------------------------------------------------------ Allergiker-Modus
  //
  // Für Allergiker werden bestimmte Aufgaben öfter fällig. Die Aufgaben selbst
  // bleiben unverändert – es wird nur mit einem kürzeren „wirksamen“ Intervall
  // gerechnet, so dass das Ausschalten alles wiederherstellt.

  /** Faktor pro Aufgabenart und Allergie (0,5 = doppelt so oft). */
  const ALLERGY_FACTORS = {
    mites: { bedding: 0.5, mattress: 0.34, upholstery: 0.25, textiles: 0.5, vacuum: 0.5, dust: 0.5, curtains: 0.5 },
    pollen: { bedding: 0.5, vacuum: 0.5, mop: 0.5, dust: 0.5, upholstery: 0.5, curtains: 0.5, window: 0.5 },
    pets: { vacuum: 0.5, mop: 0.5, upholstery: 0.25, bedding: 0.5, dust: 0.5, textiles: 0.5 },
    mold: { wet: 0.5, window: 0.5, laundryMachine: 0.5 },
  };
  // Pollen fliegen in Mitteleuropa grob von Februar bis September.
  const POLLEN_MONTHS = [2, 3, 4, 5, 6, 7, 8, 9];

  /** Art einer Aufgabe für den Allergiker-Modus – am Namen erkannt. */
  function careCategory(task) {
    const n = (task.name || '').toLowerCase();
    if (/bettwäsche|bettwaesche|bett.*beziehen/.test(n)) return 'bedding';
    if (/matratze|encasing/.test(n)) return 'mattress';
    if (/sofa|couch|polster|sessel/.test(n)) return 'upholstery';
    if (/vorhang|vorhänge|gardine/.test(n)) return 'curtains';
    if (/kuscheltier|teppich|kissen|decke/.test(n)) return 'textiles';
    if (/fenster/.test(n)) return 'window';
    if (/waschmaschine/.test(n)) return 'laundryMachine';
    if (/fugen|dusche|badewanne|abfluss/.test(n)) return 'wet';
    if (/staub wischen|abstauben|staubwischen/.test(n)) return 'dust';
    const floor = floorType(task);
    return floor || '';
  }

  function isPollenSeason(day) {
    return POLLEN_MONTHS.includes(dayToDate(day).getMonth() + 1);
  }

  /** Aktive Allergien an diesem Tag (Pollen nur in der Saison). */
  function activeAllergies(settings, day) {
    const a = settings && settings.allergy;
    if (!a || !a.enabled) return [];
    return (a.types || []).filter((type) => ALLERGY_FACTORS[type] && (type !== 'pollen' || isPollenSeason(day)));
  }

  /** Wirksames Intervall: im Allergiker-Modus ggf. verkürzt. */
  function effectiveInterval(task, settings, day) {
    // Folgeaufgaben und die Allergiker-Zusatzaufgaben selbst haben schon das passende Intervall.
    if (task.trigger || task.allergyKey) return task.interval;
    const types = activeAllergies(settings, day === undefined ? today() : day);
    if (!types.length) return task.interval;
    const cat = careCategory(task);
    if (!cat) return task.interval;
    const factor = Math.min(1, ...types.map((type) => ALLERGY_FACTORS[type][cat] || 1));
    return Math.max(1, Math.round(task.interval * factor));
  }

  function urgency(task, day, lastDone, settings) {
    if (task.trigger) return followUpUrgency(task.dueOn, day);
    const last = lastDone !== undefined ? lastDone : task.lastDone;
    if (last === null || last === undefined) return 1;
    return Math.max(0, (day - last) / Math.max(1, effectiveInterval(task, settings, day)));
  }

  function dueDay(task, settings) {
    if (task.trigger) return task.dueOn === null || task.dueOn === undefined ? Infinity : task.dueOn;
    if (task.lastDone === null || task.lastDone === undefined) return today();
    return task.lastDone + effectiveInterval(task, settings);
  }

  function isActive(task, day) {
    return !task.paused && !(task.snoozedUntil && task.snoozedUntil > day);
  }

  /**
   * Art der Bodenreinigung einer Aufgabe: 'vacuum' (saugen), 'mop' (wischen) oder ''.
   * Eine ausdrückliche Angabe (task.floor) hat Vorrang, sonst wird am Namen erkannt –
   * „Sofa absaugen“ oder „Staub wischen“ sind keine Bodenaufgaben.
   */
  function floorType(task) {
    if (typeof task.floor === 'string') return task.floor;
    const name = (task.name || '').toLowerCase();
    if (/(^|\s)(staub)?saugen\b/.test(name) && !/absaugen|sofa|matratze|polster/.test(name)) return 'vacuum';
    if (/boden.*(wischen|feucht)|wischen.*boden/.test(name)) return 'mop';
    return '';
  }

  /** Übernimmt ein Saug- bzw. Wischroboter diese Aufgabe? */
  function robotHandles(task, settings) {
    const robot = settings && settings.robot;
    if (!robot) return false;
    const type = floorType(task);
    if (!type || !robot[type]) return false;
    return !(robot.excludedRooms || []).includes(task.roomId);
  }

  /** Aufgabe soll an diesem Tag von Hand eingeplant werden. */
  function isPlannable(task, day, settings) {
    if (task.season === 'pollen' && !isPollenSeason(day)) return false;
    return isActive(task, day) && !robotHandles(task, settings);
  }

  // Gelernte Dauern: so viele Messungen werden höchstens berücksichtigt.
  const MAX_SAMPLES = 5;

  /** Geschätzte Dauer in Minuten – gelernt aus dem Timer, sonst die eingestellte Dauer. */
  function estimate(task) {
    return task.learnedMinutes || task.minutes;
  }

  /**
   * Merkt sich eine gemessene Dauer und aktualisiert die Schätzung. Ausreißer
   * (mehr als das Vierfache bzw. weniger als ein Viertel der Schätzung) werden
   * ignoriert, z. B. wenn mehrere Aufgaben auf einmal abgehakt wurden.
   * Gibt true zurück, wenn die Messung verwendet wurde.
   */
  function recordDuration(task, actualMinutes) {
    const est = estimate(task);
    if (!(actualMinutes > 0) || actualMinutes > est * 4 || actualMinutes < est / 4) return false;
    const samples = (task.durations || []).concat(Math.round(actualMinutes * 10) / 10).slice(-MAX_SAMPLES);
    task.durations = samples;
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    // Bei nur einer Messung noch die eigene Angabe mit einbeziehen.
    const value = samples.length === 1 ? (avg + task.minutes) / 2 : avg;
    task.learnedMinutes = Math.max(1, Math.round(value));
    return true;
  }

  /**
   * Zusatzaufgaben, wenn man schneller fertig ist: die dringendsten aktiven
   * Aufgaben, die noch in die Restzeit passen und schon etwas schmutzig sind.
   */
  function bonusCandidates(state, day, excludeIds, maxMinutes) {
    const exclude = new Set(excludeIds || []);
    return (state.tasks || [])
      .filter((t) => isPlannable(t, day, state.settings) && !exclude.has(t.id) && estimate(t) <= maxMinutes)
      .map((t) => ({ task: t, u: urgency(t, day, undefined, state.settings) }))
      .filter((e) => e.u >= 0.5)
      .sort((a, b) => b.u - a.u)
      .map((e) => e.task);
  }

  function budgetFor(settings, day) {
    const budgets = settings.minutesPerWeekday || [];
    const b = budgets[weekday(day)];
    return typeof b === 'number' ? b : 30;
  }

  /**
   * Verteilt eine Aufgabe auf ein Haushaltsmitglied: feste Zuständigkeit hat
   * Vorrang, sonst bekommt sie, wer an diesem Tag (und dann in der Woche)
   * am wenigsten zu tun hat.
   */
  function pickMember(task, members, dayLoad, weekLoad, day) {
    if (!members.length) return null;
    if (task.assignee && members.some((m) => m.id === task.assignee)) return task.assignee;
    const available = members.filter((m) => !(m.offDays || []).includes(weekday(day)));
    const pool = available.length ? available : members;
    let best = pool[0];
    for (const m of pool) {
      const a = (dayLoad[m.id] || 0) * 1000 + (weekLoad[m.id] || 0);
      const b = (dayLoad[best.id] || 0) * 1000 + (weekLoad[best.id] || 0);
      if (a < b) best = m;
    }
    return best.id;
  }

  /**
   * Erstellt den Plan für `days` Tage ab `startDay`.
   * `doneToday` enthält die IDs der Aufgaben, die am Starttag schon erledigt
   * wurden – deren Zeit wird vom Budget abgezogen.
   */
  function planDays(state, startDay, days, doneToday) {
    const tasks = state.tasks || [];
    const members = state.members || [];
    const settings = state.settings || {};
    const done = new Set(doneToday || []);
    const sim = new Map(tasks.map((t) => [t.id, t.lastDone]));
    // Fälligkeit der Folgeaufgaben in der Simulation – und wer wen auslöst.
    const simDue = new Map(tasks.filter((t) => t.trigger).map((t) => [t.id, t.dueOn]));
    const followUps = new Map();
    for (const t of tasks) {
      if (!t.trigger) continue;
      if (!followUps.has(t.trigger.afterTaskId)) followUps.set(t.trigger.afterTaskId, []);
      followUps.get(t.trigger.afterTaskId).push(t);
    }
    const weekLoad = {};
    const plan = [];

    for (let i = 0; i < days; i++) {
      const day = startDay + i;
      let budget = budgetFor(settings, day);
      const dayLoad = {};
      const items = [];

      if (i === 0) {
        for (const t of tasks) if (done.has(t.id)) budget -= estimate(t);
      }

      const eligible = tasks.filter((t) => isPlannable(t, day, settings) && !(i === 0 && done.has(t.id)));
      const scored = eligible
        .map((t) => ({ task: t, u: t.trigger ? followUpUrgency(simDue.get(t.id), day) : urgency(t, day, sim.get(t.id), settings) }))
        .filter((e) => !e.task.trigger || e.u > 0)
        .sort((a, b) => b.u - a.u || effectiveInterval(a.task, settings, day) - effectiveInterval(b.task, settings, day));

      let used = 0;
      const take = (entry) => {
        const memberId = pickMember(entry.task, members, dayLoad, weekLoad, day);
        if (memberId) {
          dayLoad[memberId] = (dayLoad[memberId] || 0) + estimate(entry.task);
          weekLoad[memberId] = (weekLoad[memberId] || 0) + estimate(entry.task);
        }
        items.push({ task: entry.task, urgency: entry.u, memberId, early: entry.u < 1 });
        used += estimate(entry.task);
        sim.set(entry.task.id, day);
        if (entry.task.trigger) simDue.set(entry.task.id, null);
        for (const f of followUps.get(entry.task.id) || []) simDue.set(f.id, day + (f.trigger.delayDays || 0));
      };

      // 0. Fällige Folgeaufgaben kommen immer dran – auch an freien Tagen (die Wäsche muss ab).
      for (const e of scored) if (e.task.trigger) take(e);
      // 1. Fällige Aufgaben nach Dringlichkeit.
      for (const e of scored) {
        if (e.task.trigger) continue;
        if (e.u < 1) break;
        // Tägliche Aufgaben passen immer rein – sie wären sonst sofort wieder fällig.
        if (budget <= 0) break;
        if (used + estimate(e.task) <= budget || effectiveInterval(e.task, settings, day) <= 1 || used === 0) take(e);
      }
      // 2. Freie Zeit mit bald fälligen Aufgaben füllen.
      for (const e of scored) {
        if (e.task.trigger || e.u >= 1 || e.u < PREFILL_THRESHOLD) continue;
        if (effectiveInterval(e.task, settings, day) < 3) continue; // Kurze Intervalle lohnen sich nicht vorzuziehen.
        if (used + estimate(e.task) <= budget) take(e);
      }

      plan.push({ day, budget: Math.max(0, budget), minutes: used, items });
    }
    return plan;
  }

  /** Sauberkeit eines Raums in Prozent (100 = alles frisch geputzt). Roboter-Aufgaben zählen nicht mit. */
  function roomCleanliness(tasks, day, settings) {
    const active = tasks.filter((t) => !t.paused && !robotHandles(t, settings));
    if (!active.length) return 100;
    const sum = active.reduce((s, t) => s + Math.min(1, urgency(t, day, undefined, settings)), 0);
    return Math.round((1 - sum / active.length) * 100);
  }

  const api = {
    dateToDay,
    dayToDate,
    today,
    weekday,
    urgency,
    dueDay,
    isActive,
    careCategory,
    isPollenSeason,
    activeAllergies,
    effectiveInterval,
    floorType,
    robotHandles,
    isPlannable,
    budgetFor,
    estimate,
    recordDuration,
    bonusCandidates,
    planDays,
    roomCleanliness,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scheduler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

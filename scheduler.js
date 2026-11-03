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
  /**
   * Aufgaben mit festem Fälligkeitstag statt Intervall: Folgeaufgaben und Pflanzenpflege
   * (task.plantId – der Tag wird aus dem Pflanzen-Modul berechnet).
   */
  function hasDueDate(task) {
    return !!(task.trigger || task.plantId);
  }

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
    if (hasDueDate(task) || task.allergyKey) return task.interval;
    const types = activeAllergies(settings, day === undefined ? today() : day);
    if (!types.length) return task.interval;
    const cat = careCategory(task);
    if (!cat) return task.interval;
    const factor = Math.min(1, ...types.map((type) => ALLERGY_FACTORS[type][cat] || 1));
    return Math.max(1, Math.round(task.interval * factor));
  }

  function urgency(task, day, lastDone, settings) {
    if (hasDueDate(task)) return followUpUrgency(task.dueOn, day);
    const last = lastDone !== undefined ? lastDone : task.lastDone;
    if (last === null || last === undefined) return 1;
    return Math.max(0, (day - last) / Math.max(1, effectiveInterval(task, settings, day)));
  }

  function dueDay(task, settings) {
    if (hasDueDate(task)) return task.dueOn === null || task.dueOn === undefined ? Infinity : task.dueOn;
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
  /** Zählt Pflanzenpflege zum Putzplan (Budget, Timer)? Standard: ja. */
  function plantsInPlan(settings) {
    return !(settings && settings.plants && settings.plants.inPlan === false);
  }

  function isPlannable(task, day, settings) {
    if (task.season === 'pollen' && !isPollenSeason(day)) return false;
    if (task.plantId && !plantsInPlan(settings)) return false;
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
  function bonusCandidates(state, day, excludeIds, maxMinutes, memberId) {
    const exclude = new Set(excludeIds || []);
    return (state.tasks || [])
      .filter((t) => isPlannable(t, day, state.settings) && !exclude.has(t.id) && estimate(t) <= maxMinutes && canDo(t, memberId, state))
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

  /** Zeit einer Person an diesem Tag in Minuten: eigenes Budget, sonst das des Haushalts. Freie Tage = 0. */
  function memberBudget(member, settings, day) {
    const wd = weekday(day);
    if ((member.offDays || []).includes(wd)) return 0;
    const own = member.minutesPerWeekday;
    if (Array.isArray(own) && typeof own[wd] === 'number') return own[wd];
    return budgetFor(settings || {}, day);
  }

  /**
   * Wer darf eine Aufgabe übernehmen? Eine fest zuständige Person hat Vorrang, dann wem der
   * Raum gehört (z. B. Kinderzimmer → Lena), sonst alle.
   */
  function candidatesFor(task, members, rooms) {
    if (task.assignee && members.some((m) => m.id === task.assignee)) return [task.assignee];
    const room = (rooms || []).find((r) => r.id === task.roomId);
    if (room && room.ownerId && members.some((m) => m.id === room.ownerId)) return [room.ownerId];
    return members.map((m) => m.id);
  }

  /** Darf diese Person die Aufgabe machen? (Ohne Mitglieder: ja.) */
  function canDo(task, memberId, state) {
    const members = state.members || [];
    if (!members.length || !memberId) return true;
    return candidatesFor(task, members, state.rooms).includes(memberId);
  }

  /**
   * Erstellt den Plan für `days` Tage ab `startDay`.
   *
   * Jede Person hat ihr eigenes Zeitbudget pro Wochentag. Fällige Aufgaben bekommt, wer sie
   * übernehmen darf und noch Zeit hat – bei mehreren die Person, die relativ am wenigsten
   * zu tun hat. Passt eine Aufgabe zu niemandem mehr, wartet sie auf den nächsten Tag.
   * Ohne Mitglieder gilt ein gemeinsames Budget.
   *
   * `doneToday` enthält die IDs der Aufgaben, die am Starttag schon erledigt wurden – deren
   * Zeit wird vom Budget abgezogen (wer sie erledigt hat, steht im Verlauf).
   */
  function planDays(state, startDay, days, doneToday) {
    const tasks = state.tasks || [];
    const members = state.members || [];
    const rooms = state.rooms || [];
    const settings = state.settings || {};
    const solo = !members.length;
    const SOLO = '';
    const done = new Set(doneToday || []);
    const sim = new Map(tasks.map((t) => [t.id, t.lastDone]));
    // Fälligkeit der Folgeaufgaben in der Simulation – und wer wen auslöst.
    const simDue = new Map(tasks.filter(hasDueDate).map((t) => [t.id, t.dueOn]));
    const followUps = new Map();
    for (const t of tasks) {
      if (!t.trigger) continue;
      if (!followUps.has(t.trigger.afterTaskId)) followUps.set(t.trigger.afterTaskId, []);
      followUps.get(t.trigger.afterTaskId).push(t);
    }
    const memberIds = new Set(members.map((m) => m.id));
    const keyOf = (memberId) => (solo ? SOLO : memberIds.has(memberId) ? memberId : members[0].id);
    const weekLoad = {};
    const plan = [];

    for (let i = 0; i < days; i++) {
      const day = startDay + i;
      const budgets = {};
      if (solo) budgets[SOLO] = budgetFor(settings, day);
      else for (const m of members) budgets[m.id] = memberBudget(m, settings, day);
      const spent = {}; // heute schon erledigt
      const planned = {};
      for (const k of Object.keys(budgets)) { spent[k] = 0; planned[k] = 0; }
      const items = [];

      if (i === 0 && done.size) {
        const todays = (state.history || []).filter((h) => h.day === startDay && !h.skipped && done.has(h.taskId));
        if (todays.length) {
          for (const h of todays) spent[keyOf(h.memberId)] += h.minutes || 0;
        } else {
          for (const t of tasks) if (done.has(t.id)) spent[keyOf(t.assignee)] += estimate(t);
        }
      }
      const load = (k) => (spent[k] + planned[k]) / Math.max(1, budgets[k]);

      const eligible = tasks.filter((t) => isPlannable(t, day, settings) && !(i === 0 && done.has(t.id)));
      const scored = eligible
        .map((t) => ({ task: t, u: hasDueDate(t) ? followUpUrgency(simDue.get(t.id), day) : urgency(t, day, sim.get(t.id), settings) }))
        .filter((e) => !hasDueDate(e.task) || e.u > 0)
        .sort((a, b) => b.u - a.u || effectiveInterval(a.task, settings, day) - effectiveInterval(b.task, settings, day));

      // Wer übernimmt? `strict`: nur wenn es ganz ins Budget passt.
      const choose = (e, strict) => {
        const cands = solo ? [SOLO] : candidatesFor(e.task, members, rooms);
        const est = estimate(e.task);
        const fits = cands.filter((k) => {
          if (!(budgets[k] - spent[k] > 0)) return false;
          if (spent[k] + planned[k] + est <= budgets[k]) return true;
          // Tägliche Aufgaben passen immer rein – sie wären sonst sofort wieder fällig;
          // und wer noch nichts eingeplant hat, bekommt eine Aufgabe auch, wenn sie etwas länger dauert.
          return !strict && (effectiveInterval(e.task, settings, day) <= 1 || planned[k] === 0);
        });
        if (!fits.length) return undefined;
        return fits.sort((a, b) => load(a) - load(b) || (weekLoad[a] || 0) - (weekLoad[b] || 0))[0];
      };

      const take = (entry, k) => {
        const est = estimate(entry.task);
        planned[k] += est;
        weekLoad[k] = (weekLoad[k] || 0) + est;
        items.push({ task: entry.task, urgency: entry.u, memberId: solo ? null : k, early: entry.u < 1 });
        sim.set(entry.task.id, day);
        if (entry.task.trigger) simDue.set(entry.task.id, null);
        else if (entry.task.plantId) simDue.set(entry.task.id, day + Math.max(1, entry.task.interval || 1));
        for (const f of followUps.get(entry.task.id) || []) simDue.set(f.id, day + (f.trigger.delayDays || 0));
      };

      // 0. Fällige Folgeaufgaben und Pflanzenpflege kommen immer dran – auch an freien Tagen
      //    (die Wäsche muss ab, eine durstige Pflanze kann nicht warten).
      for (const e of scored) {
        if (!hasDueDate(e.task)) continue;
        const cands = solo ? [SOLO] : candidatesFor(e.task, members, rooms);
        const withTime = cands.filter((k) => budgets[k] > 0);
        const pool = withTime.length ? withTime : cands;
        take(e, pool.slice().sort((a, b) => load(a) - load(b) || (weekLoad[a] || 0) - (weekLoad[b] || 0))[0]);
      }
      // 1. Fällige Aufgaben nach Dringlichkeit.
      for (const e of scored) {
        if (hasDueDate(e.task)) continue;
        if (e.u < 1) break;
        const k = choose(e, false);
        if (k !== undefined) take(e, k);
      }
      // 2. Freie Zeit mit bald fälligen Aufgaben füllen.
      for (const e of scored) {
        if (hasDueDate(e.task) || e.u >= 1 || e.u < PREFILL_THRESHOLD) continue;
        if (effectiveInterval(e.task, settings, day) < 3) continue; // Kurze Intervalle lohnen sich nicht vorzuziehen.
        if (items.some((it) => it.task === e.task)) continue;
        const k = choose(e, true);
        if (k !== undefined) take(e, k);
      }

      const total = Object.values(budgets).reduce((a, b) => a + b, 0);
      const spentAll = Object.values(spent).reduce((a, b) => a + b, 0);
      const people = solo ? {} : Object.fromEntries(members.map((m) => [m.id, { budget: budgets[m.id], done: spent[m.id], planned: planned[m.id] }]));
      plan.push({ day, budget: Math.max(0, total - spentAll), minutes: Object.values(planned).reduce((a, b) => a + b, 0), items, people });
    }
    return plan;
  }

  /** Sauberkeit eines Raums in Prozent (100 = alles frisch geputzt). Roboter- und Pflanzenaufgaben zählen nicht mit. */
  function roomCleanliness(tasks, day, settings) {
    const active = tasks.filter((t) => !t.paused && !t.plantId && !robotHandles(t, settings));
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
    hasDueDate,
    plantsInPlan,
    careCategory,
    isPollenSeason,
    activeAllergies,
    effectiveInterval,
    floorType,
    robotHandles,
    isPlannable,
    budgetFor,
    memberBudget,
    candidatesFor,
    canDo,
    estimate,
    recordDuration,
    bonusCandidates,
    planDays,
    roomCleanliness,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scheduler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

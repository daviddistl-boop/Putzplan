/* Putzplan – App-Oberfläche und Datenhaltung (localStorage). */
(function () {
  'use strict';

  const S = window.Scheduler;
  const T = window.Templates;
  const P = window.Plants;
  const Shared = window.PutzplanShared;
  const Native = window.PutzplanNative || { isNative: false };
  const SyncL = window.PutzplanSync;
  const Cloud = window.PutzplanCloud;
  const STORAGE_KEY = 'putzplan.v1';
  const ACTIVE_KEY = 'putzplan.active';
  const HOUSEHOLDS_KEY = 'putzplan.households';
  const DEVICE_KEY = 'putzplan.device';
  const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  const WEEKDAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  // ---------------------------------------------------------------- Zustand

  function defaultState() {
    return {
      version: 1,
      onboarded: false,
      rooms: [],
      tasks: [],
      members: [],
      plants: [],
      shoppingLists: [],
      shoppingItems: [],
      history: [],
      settings: { minutesPerWeekday: [20, 20, 20, 20, 20, 60, 0], perPersonBudget: true },
    };
  }

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* Speicher voll oder gesperrt */ }
  }

  // Jeder Haushalt hat seinen eigenen Speicherplatz; „local“ = ohne Konto (wie bisher).
  const stateKey = (id) => (id === 'local' ? STORAGE_KEY : `putzplan.hh.${id}`);
  let activeId = lsGet(ACTIVE_KEY) || 'local';
  // Kennung dieses Geräts – damit doppeltes Abhaken auf zwei Handys erkannt wird.
  const deviceId = lsGet(DEVICE_KEY) || (() => {
    const d = Math.random().toString(36).slice(2, 10);
    lsSet(DEVICE_KEY, d);
    return d;
  })();

  function load(id) {
    try {
      const raw = localStorage.getItem(stateKey(id === undefined ? activeId : id));
      if (raw) return Object.assign(defaultState(), JSON.parse(raw));
    } catch (e) {
      console.warn('Konnte Daten nicht laden', e);
    }
    return defaultState();
  }

  let state = load();
  let ui = { tab: 'today', roomId: null, showMore: false };

  /** Nur auf dem Gerät speichern (ohne Abgleich anzustoßen). */
  function persist() {
    // Für die Erinnerungen dieses Geräts: wer bin ich in diesem Haushalt? (wird nicht abgeglichen)
    state.me = myMemberId() || null;
    try {
      localStorage.setItem(stateKey(activeId), JSON.stringify(state));
    } catch (e) {
      toast('Speichern fehlgeschlagen – ist der Speicher voll?');
    }
    syncToServiceWorker();
    if (Native.isNative) {
      // Haushalte mit Konto sind auf dem Server gesichert, ohne Konto sichert die App eine Datei.
      if (activeId === 'local') Native.saveBackup(state);
      Native.scheduleReminders(state, Shared, S);
    }
  }

  function save() {
    persist();
    scheduleSync();
  }

  // Kopie für den Service Worker, damit die Erinnerung die heutigen Aufgaben kennt.
  function syncToServiceWorker() {
    if (Native.isNative || !('indexedDB' in window)) return;
    Shared.kvSet('state', state).catch(() => {});
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  const byId = (list, id) => list.find((x) => x.id === id);
  const room = (id) => byId(state.rooms, id);
  const task = (id) => byId(state.tasks, id);
  const member = (id) => byId(state.members, id);

  function doneTodayIds() {
    const d = S.today();
    return state.history.filter((h) => h.day === d && !h.skipped).map((h) => h.taskId);
  }

  // ---------------------------------------------------------------- Folgeaufgaben
  //
  // Eine Aufgabe kann eine Folgeaufgabe auslösen, z. B. „Wäsche aufhängen“ →
  // am nächsten Tag „Wäsche abnehmen“. Die Folgeaufgabe hat kein eigenes
  // Intervall; sie wird fällig, sobald die auslösende Aufgabe erledigt ist.

  const followUpsOf = (taskId) => state.tasks.filter((t) => t.trigger && t.trigger.afterTaskId === taskId);
  const DELAY_LABELS = ['Am selben Tag', 'Am nächsten Tag', 'Nach 2 Tagen', 'Nach 3 Tagen'];

  function setFollowUp(parent, name, delayDays) {
    const existing = followUpsOf(parent.id)[0];
    if (!name) {
      if (existing) state.tasks = state.tasks.filter((t) => t.id !== existing.id);
      return;
    }
    if (existing) {
      existing.name = name;
      existing.trigger.delayDays = delayDays;
      return;
    }
    state.tasks.push({
      id: uid(), roomId: parent.roomId, name, interval: parent.interval, minutes: 10,
      lastDone: null, assignee: parent.assignee || null, paused: false, snoozedUntil: null,
      trigger: { afterTaskId: parent.id, delayDays }, dueOn: null, oneOff: parent.oneOff || undefined,
    });
  }

  // Bekannte Paare, die automatisch eingerichtet werden.
  function autoFollowUp(t) {
    if (t.trigger || followUpsOf(t.id).length) return;
    if (/w(ä|ae)sche.*aufh(ä|ae)ng/i.test(t.name)) setFollowUp(t, 'Wäsche abnehmen', 1);
  }

  // ---------------------------------------------------------------- Helfer

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function fmtMinutes(min) {
    if (min < 60) return `${min} Min.`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
  }

  function intervalLabel(days) {
    const hit = T.INTERVALS.find(([d]) => d === days);
    return hit ? hit[1] : `Alle ${days} Tage`;
  }

  function dayLabel(day) {
    const diff = day - S.today();
    if (diff === 0) return 'Heute';
    if (diff === 1) return 'Morgen';
    if (diff === -1) return 'Gestern';
    const d = S.dayToDate(day);
    return `${WEEKDAYS[S.weekday(day)]}, ${d.getDate()}.${d.getMonth() + 1}.`;
  }

  function dueText(t) {
    if (t.paused) return 'Pausiert';
    if (t.season === 'pollen' && !S.isPollenSeason(S.today())) return 'Ruht bis zur Pollensaison 🌼';
    if (t.plantId && (t.dueOn === null || t.dueOn === undefined)) return 'Winterpause ❄️';
    if (t.trigger && (t.dueOn === null || t.dueOn === undefined)) {
      const parent = task(t.trigger.afterTaskId);
      return parent ? `Kommt nach „${parent.name}“` : 'Wartet';
    }
    const today = S.today();
    if (t.snoozedUntil && t.snoozedUntil > today) return `Verschoben auf ${dayLabel(t.snoozedUntil)}`;
    const diff = S.dueDay(t, state.settings) - today;
    if (diff < -1) return `Seit ${-diff} Tagen überfällig`;
    if (diff === -1) return 'Seit gestern überfällig';
    if (diff === 0) return 'Heute fällig';
    if (diff === 1) return 'Morgen fällig';
    return `Fällig in ${diff} Tagen`;
  }

  // Dauer einer Aufgabe; ⏱ zeigt an, dass sie mit dem Timer gelernt wurde.
  function minutesLabel(t) {
    return t.learnedMinutes ? `⏱ ca. ${fmtMinutes(t.learnedMinutes)}` : fmtMinutes(t.minutes);
  }

  function cleanlinessColor(pct) {
    if (pct >= 70) return 'var(--good)';
    if (pct >= 40) return 'var(--warn)';
    return 'var(--bad)';
  }

  // Farbe des Verschmutzungsbalkens einer Aufgabe (u = 1 heißt fällig).
  function dirtColor(u) {
    if (u < 0.5) return 'var(--good)';
    if (u < 0.85) return 'var(--warn)';
    return 'var(--bad)';
  }

  function avatar(m, size) {
    if (!m) return '';
    const cls = size === 'lg' ? 'avatar avatar-lg' : 'avatar';
    return `<span class="${cls}" style="background:${m.color}" title="${esc(m.name)}">${esc(m.name.charAt(0).toUpperCase())}</span>`;
  }

  let toastTimer;
  function toast(msg, action) {
    const el = document.getElementById('toast');
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-btn" data-toast-action>${esc(action.label)}</button>` : ''}`;
    el.hidden = false;
    if (action) el.querySelector('[data-toast-action]').onclick = () => { action.run(); el.hidden = true; };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
  }

  // ---------------------------------------------------------------- Aktionen

  function completeTask(taskId, memberId, opts) {
    const t = task(taskId);
    if (!t) return;
    const o = opts || {};
    const day = S.today();
    const entry = {
      id: uid(), taskId, day, memberId: memberId || myMemberId() || (state.members[0] && state.members[0].id) || null,
      minutes: S.estimate(t), prevLastDone: t.lastDone, prevSnoozed: t.snoozedUntil || null, at: Date.now(), dev: deviceId,
    };
    if (o.actualMs !== undefined) {
      // Mit dem Timer gemessen: Dauer merken und daraus lernen.
      entry.session = true;
      entry.actualMinutes = Math.round((o.actualMs / MIN) * 10) / 10;
      entry.prevLearned = t.learnedMinutes || null;
      entry.prevDurations = t.durations ? t.durations.slice() : null;
      S.recordDuration(t, o.actualMs / MIN);
    }
    // Folgeaufgaben auslösen bzw. die erledigte Folgeaufgabe zurücksetzen.
    entry.followUps = followUpsOf(t.id).map((f) => ({ id: f.id, prev: f.dueOn ?? null }));
    for (const f of followUpsOf(t.id)) f.dueOn = day + (f.trigger.delayDays || 0);
    if (t.trigger) { entry.prevDueOn = t.dueOn ?? null; t.dueOn = null; }
    if (t.oneOff) {
      // Einmalige Aufgabe: nach dem Erledigen archivieren (bleibt für den Verlauf erhalten).
      entry.oneOff = true;
      t.archived = true;
      t.paused = true;
    }
    state.history.push(entry);
    t.lastDone = day;
    t.snoozedUntil = null;
    if (t.plantId) plantCareDone(t, entry);
    if (!o.silent) {
      save();
      render();
      toast(`„${t.name}“ erledigt 🎉`, { label: 'Rückgängig', run: () => undoEntry(entry.id) });
    }
    // Nach dem Gießen kurz fragen, wie die Erde war – daraus lernt die App.
    if (t.plantCare === 'water') setTimeout(() => plantFeedbackDialog(entry.id), o.silent ? 0 : 50);
  }

  function skipTask(taskId) {
    const t = task(taskId);
    const entry = { id: uid(), taskId, day: S.today(), memberId: null, minutes: 0, skipped: true, prevLastDone: t.lastDone, prevSnoozed: t.snoozedUntil || null, at: Date.now(), dev: deviceId };
    if (t.trigger) { entry.prevDueOn = t.dueOn ?? null; t.dueOn = null; }
    state.history.push(entry);
    t.lastDone = S.today();
    t.snoozedUntil = null;
    save();
    render();
    toast(`„${t.name}“ übersprungen`, { label: 'Rückgängig', run: () => undoEntry(entry.id) });
  }

  function snoozeTask(taskId, days) {
    const t = task(taskId);
    t.snoozedUntil = S.today() + days;
    save();
    render();
    toast(`„${t.name}“ auf ${dayLabel(t.snoozedUntil)} verschoben`);
  }

  function undoEntry(entryId, silent) {
    const idx = state.history.findIndex((h) => h.id === entryId);
    if (idx < 0) return;
    const h = state.history[idx];
    const t = task(h.taskId);
    if (t) {
      t.lastDone = h.prevLastDone;
      t.snoozedUntil = h.prevSnoozed;
      if (h.prevDueOn !== undefined) t.dueOn = h.prevDueOn;
      for (const f of h.followUps || []) {
        const ft = task(f.id);
        if (ft) ft.dueOn = f.prev;
      }
      if (h.oneOff) {
        t.archived = false;
        t.paused = false;
      }
      if (h.session) {
        t.learnedMinutes = h.prevLearned || undefined;
        t.durations = h.prevDurations || undefined;
      }
    }
    if (h.plantPrev) {
      const p = plant(h.plantPrev.id);
      if (p) Object.assign(p, h.plantPrev);
    }
    state.history.splice(idx, 1);
    if (h.plantPrev) syncPlants();
    const s = state.session;
    if (s && s.doneIds.includes(h.taskId) && h.day === S.today()) {
      s.doneIds = s.doneIds.filter((id) => id !== h.taskId);
      s.allDone = false;
    }
    if (silent) return;
    save();
    render();
  }
  // ---------------------------------------------------------------- Putz-Timer
  //
  // Man startet den Timer mit seiner Zeit für heute und hakt währenddessen ab.
  // Die Zeit zwischen zwei Häkchen wird als Dauer der Aufgabe gemessen – daraus
  // lernt die App, wie lange man wirklich braucht. Ist man schneller, kommt eine
  // Bonus-Aufgabe dazu; was am Ende offen ist, wird auf morgen verschoben.

  const MIN = 60000;
  let sessionTimer = null;
  let wakeLock = null;

  function sessionElapsed(s) {
    return Math.max(0, (s.pausedAt || Date.now()) - s.startedAt - s.pausedMs);
  }

  function sessionRemaining(s) {
    return s.durationMs - sessionElapsed(s);
  }

  function fmtClock(ms) {
    const neg = ms < 0;
    const total = Math.round(Math.abs(ms) / 1000);
    const m = Math.floor(total / 60);
    const sec = String(total % 60).padStart(2, '0');
    return `${neg ? '+' : ''}${m}:${sec}`;
  }

  function sessionOpenIds(s) {
    const done = new Set(s.doneIds);
    return s.taskIds.filter((id) => !done.has(id) && task(id));
  }

  /** Restzeit des heutigen Budgets – Vorschlag für die Timer-Dauer. */
  function remainingBudgetToday() {
    const today = S.today();
    const me = personalScope();
    const doneMin = state.history.filter((h) => h.day === today && !h.skipped && (!me || h.memberId === me)).reduce((sum, h) => sum + h.minutes, 0);
    let budget;
    if (me) budget = S.memberBudget(member(me), state.settings, today);
    else if (state.members.length) budget = state.members.reduce((sum, m) => sum + S.memberBudget(m, state.settings, today), 0);
    else budget = S.budgetFor(state.settings, today);
    return Math.max(0, budget - doneMin);
  }

  /** Wer bin ich – wenn das bekannt ist und es mehrere Personen gibt? Sonst null (dann gilt alles für alle). */
  function personalScope() {
    const me = myMemberId();
    return me && state.members.length > 1 ? me : null;
  }

  /** „Heute“ zeigt nur meine Aufgaben (Standard) – oder alle. */
  function scopeMine() {
    const me = personalScope();
    return me && (ui.todayScope || 'mine') === 'mine' ? me : null;
  }

  /** Meine Aufgaben aus dem Tagesplan (ohne bekannte Person: alle). */
  function myPlanItems(plan) {
    const me = personalScope();
    return me ? plan.items.filter((i) => !i.memberId || i.memberId === me) : plan.items;
  }

  function startSessionDialog() {
    const today = S.today();
    const plan = S.planDays(state, today, 1, doneTodayIds())[0];
    plan.items = myPlanItems(plan);
    const planMin = plan.items.reduce((sum, i) => sum + S.estimate(i.task), 0);
    const suggested = Math.max(5, Math.round((remainingBudgetToday() || planMin || 15) / 5) * 5);
    const options = [...new Set([10, 15, 20, 30, 45, 60, suggested])].sort((a, b) => a - b);
    let chosen = suggested;
    openModal(`
      <h2>⏱️ Putz-Timer</h2>
      <p class="muted">Wie lange möchtest du jetzt putzen? Hake ab, was du schaffst. Bist du schneller, kommt noch etwas dazu –
        was übrig bleibt, wandert auf morgen.</p>
      <p class="small">${plan.items.length
        ? `Geplant: <strong>${plan.items.length} Aufgabe${plan.items.length === 1 ? '' : 'n'}</strong> · geschätzt ${fmtMinutes(planMin)}`
        : 'Heute ist nichts mehr fällig – der Timer sucht dir passende Aufgaben, die bald dran sind.'}</p>
      <div class="chip-grid">${options.map((m) => `<button class="chip ${m === chosen ? 'on' : ''}" data-min="${m}">${m} Min.</button>`).join('')}</div>
      <div class="btn-row">
        <button class="btn" data-cancel>Abbrechen</button>
        <button class="btn primary" data-go>▶ Los geht's</button>
      </div>`, (el) => {
      el.querySelectorAll('[data-min]').forEach((b) => {
        b.onclick = () => {
          chosen = +b.dataset.min;
          el.querySelectorAll('[data-min]').forEach((x) => x.classList.toggle('on', x === b));
        };
      });
      el.querySelector('[data-cancel]').onclick = closeModal;
      el.querySelector('[data-go]').onclick = () => { closeModal(); startSession(chosen); };
    });
  }

  function startSession(minutes) {
    const today = S.today();
    const plan = S.planDays(state, today, 1, doneTodayIds())[0];
    // Der Timer nimmt meine Aufgaben – die anderen putzen mit ihrem eigenen Handy.
    plan.items = myPlanItems(plan);
    state.session = {
      day: today,
      startedAt: Date.now(),
      durationMs: minutes * MIN,
      pausedAt: null,
      pausedMs: 0,
      lastMark: 0,
      taskIds: plan.items.map((i) => i.task.id),
      bonusIds: [],
      addedIds: [],
      doneIds: [],
      times: {},
      memberIds: Object.fromEntries(plan.items.map((i) => [i.task.id, i.memberId])),
      timeUp: false,
      allDone: false,
    };
    ui.tab = 'today';
    if (!state.session.taskIds.length) addBonusTask(true);
    save();
    syncTimerAlarm();
    requestWakeLock();
    render();
  }

  /** Nimmt die nächste passende Aufgabe dazu. Gibt false zurück, wenn keine mehr passt. */
  function addBonusTask(silent) {
    const s = state.session;
    const remainingMin = sessionRemaining(s) / MIN;
    if (remainingMin < 2) return false;
    const next = S.bonusCandidates(state, S.today(), s.taskIds.concat(doneTodayIds()), remainingMin + 1, personalScope())[0];
    if (!next) return false;
    s.taskIds.push(next.id);
    s.bonusIds.push(next.id);
    s.allDone = false;
    if (!silent) toast(`Du bist schneller! ✨ Dazu kommt: ${next.name}`);
    return true;
  }

  // Zusätzliche Aufgaben im Timer: von Hand dazugenommen oder als Bonus.
  // Sie wandern am Ende nicht auf morgen, weil sie heute gar nicht geplant waren.
  function sessionExtraIds(s) {
    return new Set(s.bonusIds.concat(s.addedIds || []));
  }

  /** Aufgaben, die man im Timer dazunehmen oder eintauschen kann – dringendste zuerst. */
  function pickCandidates(excludeIds) {
    const today = S.today();
    const exclude = new Set(excludeIds.concat(doneTodayIds()));
    return state.tasks
      .filter((t) => !t.paused && !t.archived && !exclude.has(t.id) && !S.robotHandles(t, state.settings)
        && !(S.hasDueDate(t) && (t.dueOn === null || t.dueOn === undefined))
        && !(t.plantId && !S.plantsInPlan(state.settings)))
      .sort((a, b) => S.urgency(b, today, undefined, state.settings) - S.urgency(a, today, undefined, state.settings));
  }

  /**
   * Auswahl-Dialog mit Suchfeld. `compareTo`: beim Tauschen die bisherige Aufgabe,
   * damit dringendere Aufgaben markiert werden können.
   */
  function taskPicker({ title, intro, excludeIds, compareTo, extraButtons, onPick }) {
    const today = S.today();
    const all = pickCandidates(excludeIds);
    const refU = compareTo ? S.urgency(compareTo, today, undefined, state.settings) : null;
    const row = (t) => {
      const r = room(t.roomId);
      const u = S.urgency(t, today, undefined, state.settings);
      const urgent = refU !== null && u > refU + 0.05;
      return `<li class="row pick-row" data-pick="${t.id}">
        <span class="room-icon">${r ? r.icon : '🧽'}</span>
        <div class="row-main">
          <div class="row-title">${esc(t.name)}</div>
          <div class="row-sub">${r ? esc(r.name) : ''} · ${minutesLabel(t)} · <span class="${u >= 1 ? 'bad-text' : ''}">${dueText(t)}</span>
            ${urgent ? '<span class="badge bad">dringender</span>' : ''}</div>
          <div class="dirt"><span style="width:${Math.min(100, u * 100)}%;background:${dirtColor(u)}"></span></div>
        </div>
      </li>`;
    };
    openModal(`
      <h2>${title}</h2>
      ${intro ? `<p class="muted small">${intro}</p>` : ''}
      ${extraButtons || ''}
      <input class="input" type="search" placeholder="🔍 Aufgabe oder Raum suchen" data-pick-search>
      <ul class="list pick-list"></ul>
      <button class="btn block" data-cancel>Abbrechen</button>`, (el) => {
      const list = el.querySelector('.pick-list');
      const draw = (q) => {
        const query = q.trim().toLowerCase();
        const items = all.filter((t) => {
          if (!query) return true;
          const r = room(t.roomId);
          return t.name.toLowerCase().includes(query) || (r && r.name.toLowerCase().includes(query));
        }).slice(0, 40);
        list.innerHTML = items.length ? items.map(row).join('') : '<p class="muted small center">Keine passende Aufgabe.</p>';
      };
      draw('');
      el.querySelector('[data-pick-search]').oninput = (ev) => draw(ev.target.value);
      list.onclick = (ev) => {
        const li = ev.target.closest('[data-pick]');
        if (!li) return;
        closeModal();
        onPick(li.dataset.pick);
      };
      el.querySelector('[data-cancel]').onclick = closeModal;
    });
  }

  function addToSession(taskId, how) {
    const s = state.session;
    if (!s || s.taskIds.includes(taskId)) return;
    s.taskIds.push(taskId);
    if (!s.addedIds) s.addedIds = [];
    s.addedIds.push(taskId);
    s.memberIds[taskId] = task(taskId).assignee || null;
    s.allDone = false;
    save();
    syncTimerAlarm();
    render();
    toast(`${how === 'new' ? 'Neu angelegt' : 'Dazugenommen'}: ${task(taskId).name}`);
  }

  /** „＋ Aufgabe hinzufügen“ im Timer: vorhandene Aufgabe wählen oder eigene anlegen. */
  function sessionAddDialog() {
    const s = state.session;
    taskPicker({
      title: '＋ Aufgabe dazunehmen',
      intro: 'Wähle eine Aufgabe aus deinem Plan oder lege eine eigene an.',
      excludeIds: s.taskIds,
      extraButtons: '<button class="btn primary block" data-new-task>✎ Eigene Aufgabe anlegen</button>',
      onPick: (id) => addToSession(id),
    });
    const btn = document.querySelector('#modal-root [data-new-task]');
    if (btn) btn.onclick = () => { closeModal(); quickTaskDialog((id) => addToSession(id, 'new')); };
  }

  /** Schnell eine eigene Aufgabe anlegen – auf Wunsch nur einmalig. */
  function quickTaskDialog(onCreated) {
    const rooms = state.rooms.filter((r) => !r.robot);
    openModal(`
      <h2>Eigene Aufgabe</h2>
      <form class="form">
        <label>Was willst du machen?<input class="input" name="name" required placeholder="z. B. Keller aufräumen" autofocus></label>
        <label>Raum<select class="input" name="roomId">${rooms.map((r) => `<option value="${r.id}">${r.icon} ${esc(r.name)}</option>`).join('')}</select></label>
        <label>Dauer (Minuten)<input class="input" type="number" min="1" max="480" name="minutes" value="10"></label>
        <label>Wiederholen?<select class="input" name="interval">
          <option value="0">Nur dieses eine Mal</option>
          ${T.INTERVALS.map(([d, l]) => `<option value="${d}">${l}</option>`).join('')}
        </select></label>
        <div class="btn-row">
          <button type="button" class="btn" data-cancel>Abbrechen</button>
          <button type="submit" class="btn primary">Dazunehmen</button>
        </div>
      </form>`, (el) => {
      el.querySelector('[data-cancel]').onclick = closeModal;
      el.querySelector('form').onsubmit = (ev) => {
        ev.preventDefault();
        const f = ev.target;
        const name = f.name.value.trim();
        if (!name) return;
        const interval = parseInt(f.interval.value, 10) || 0;
        const t = {
          id: uid(), roomId: f.roomId.value, name,
          interval: interval || 365, minutes: Math.max(1, parseInt(f.minutes.value, 10) || 10),
          lastDone: S.today() - (interval || 365), assignee: null, paused: false, snoozedUntil: null,
        };
        if (!interval) t.oneOff = true;
        state.tasks.push(t);
        autoFollowUp(t);
        closeModal();
        onCreated(t.id);
      };
    });
  }

  /** Eine offene Aufgabe im Timer gegen eine andere tauschen (oder nur herausnehmen). */
  function sessionSwapDialog(taskId) {
    const s = state.session;
    const old = task(taskId);
    const extra = sessionExtraIds(s).has(taskId);
    const fate = extra ? 'fliegt aus dem Timer' : 'wandert auf morgen';
    taskPicker({
      title: `⇄ „${esc(old.name)}“ tauschen`,
      intro: `Wähle, was stattdessen dran ist. „${esc(old.name)}“ ${fate}.`,
      excludeIds: s.taskIds,
      compareTo: old,
      extraButtons: `<button class="btn block" data-remove-only>✕ Nur herausnehmen (${fate})</button>`,
      onPick: (newId) => swapInSession(taskId, newId),
    });
    const btn = document.querySelector('#modal-root [data-remove-only]');
    if (btn) btn.onclick = () => { closeModal(); swapInSession(taskId, null); };
  }

  function swapInSession(oldId, newId) {
    const s = state.session;
    const extra = sessionExtraIds(s);
    const wasExtra = extra.has(oldId);
    const idx = s.taskIds.indexOf(oldId);
    if (idx < 0) return;
    if (newId) {
      s.taskIds.splice(idx, 1, newId);
      s.memberIds[newId] = s.memberIds[oldId] || task(newId).assignee || null;
      // Wer eine geplante Aufgabe ersetzt, übernimmt deren Platz im Plan.
      if (wasExtra) (s.addedIds = s.addedIds || []).push(newId);
    } else {
      s.taskIds.splice(idx, 1);
    }
    s.bonusIds = s.bonusIds.filter((id) => id !== oldId);
    s.addedIds = (s.addedIds || []).filter((id) => id !== oldId);
    delete s.memberIds[oldId];
    const old = task(oldId);
    if (!wasExtra) old.snoozedUntil = S.today() + 1;
    if (!sessionOpenIds(s).length && !s.timeUp) s.allDone = !addBonusTask(true);
    save();
    syncTimerAlarm();
    render();
    toast(newId ? `Getauscht: ${task(newId).name}${wasExtra ? '' : ` · „${old.name}“ auf morgen`}` : `„${old.name}“ ${wasExtra ? 'herausgenommen' : 'auf morgen verschoben'}`);
  }

  function sessionToggle(taskId) {
    const s = state.session;
    if (!s) return;
    if (s.doneIds.includes(taskId)) {
      // Häkchen zurücknehmen: Erledigt-Eintrag und gelernte Dauer zurücksetzen.
      const entry = state.history.slice().reverse().find((h) => h.taskId === taskId && h.day === S.today() && h.session);
      if (entry) undoEntry(entry.id, true);
      s.doneIds = s.doneIds.filter((id) => id !== taskId);
      delete s.times[taskId];
      s.allDone = false;
      save();
      render();
      return;
    }
    const elapsed = sessionElapsed(s);
    const tookMs = elapsed - s.lastMark;
    s.lastMark = elapsed;
    s.times[taskId] = tookMs;
    s.doneIds.push(taskId);
    completeTask(taskId, s.memberIds[taskId] || task(taskId).assignee, { silent: true, actualMs: tookMs });
    if (!sessionOpenIds(s).length && !s.timeUp) {
      if (!addBonusTask(false)) s.allDone = true;
    }
    save();
    render();
  }

  function togglePause() {
    const s = state.session;
    if (s.pausedAt) {
      s.pausedMs += Date.now() - s.pausedAt;
      s.pausedAt = null;
      requestWakeLock();
    } else {
      s.pausedAt = Date.now();
    }
    save();
    syncTimerAlarm();
    render();
  }

  function extendSession(minutes) {
    const s = state.session;
    s.durationMs = sessionElapsed(s) + Math.max(0, sessionRemaining(s)) + minutes * MIN;
    s.timeUp = false;
    save();
    syncTimerAlarm();
    render();
  }

  /** Beendet den Timer. `moveOpen`: offene geplante Aufgaben auf morgen verschieben. */
  function endSession(moveOpen) {
    const s = state.session;
    if (!s) return;
    const open = sessionOpenIds(s);
    const extra = sessionExtraIds(s);
    let moved = 0;
    if (moveOpen) {
      for (const id of open) {
        if (extra.has(id)) continue; // Zusatzaufgaben waren heute gar nicht geplant.
        if (task(id).plantId) continue; // Pflanzen warten nicht – sie bleiben fällig.
        task(id).snoozedUntil = S.today() + 1;
        moved++;
      }
    }
    const minutes = Math.round(sessionElapsed(s) / MIN);
    state.session = null;
    save();
    syncTimerAlarm();
    releaseWakeLock();
    render();
    const parts = [`${s.doneIds.length} erledigt in ${fmtMinutes(Math.max(1, minutes))}`];
    if (moved) parts.push(`${moved} auf morgen verschoben`);
    toast(`${s.doneIds.length ? '💪 ' : ''}${parts.join(' · ')}`);
  }

  function confirmEndSession() {
    const s = state.session;
    const extra = sessionExtraIds(s);
    const open = sessionOpenIds(s).filter((id) => !extra.has(id) && !task(id).plantId);
    if (!open.length) { endSession(false); return; }
    openModal(`
      <h2>Timer beenden?</h2>
      <p class="muted">${open.length} Aufgabe${open.length === 1 ? ' ist' : 'n sind'} noch offen.</p>
      <div class="menu">
        <button data-m="move">➡️ Offene auf morgen verschieben</button>
        <button data-m="keep">📋 Für heute auf der Liste lassen</button>
        <button data-m="cancel" class="muted">Weiter putzen</button>
      </div>`, (el) => {
      el.querySelectorAll('[data-m]').forEach((b) => {
        b.onclick = () => {
          closeModal();
          if (b.dataset.m === 'move') endSession(true);
          if (b.dataset.m === 'keep') endSession(false);
        };
      });
    });
  }

  // Auf Android eine Benachrichtigung zum Ablauf der Zeit einplanen.
  function syncTimerAlarm() {
    if (!Native.isNative || !Native.scheduleTimerEnd) return;
    const s = state.session;
    if (s && !s.pausedAt && !s.timeUp && sessionRemaining(s) > 1000) {
      Native.scheduleTimerEnd(new Date(Date.now() + sessionRemaining(s)), sessionOpenIds(s).length);
    } else {
      Native.cancelTimerEnd();
    }
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { /* nicht unterstützt oder nicht erlaubt */ }
  }

  function releaseWakeLock() {
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  function tickSession() {
    const s = state.session;
    if (!s || ui.tab !== 'today') return;
    const remaining = sessionRemaining(s);
    if (remaining <= 0 && !s.timeUp && !s.allDone) {
      s.timeUp = true;
      save();
      syncTimerAlarm();
      if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
      render();
      return;
    }
    const clock = document.getElementById('session-clock');
    if (!clock || s.timeUp) return;
    clock.textContent = fmtClock(remaining);
    const ring = document.getElementById('session-ring');
    const pct = Math.max(0, Math.min(100, (remaining / s.durationMs) * 100));
    ring.style.setProperty('--p', pct.toFixed(2));
    ring.classList.toggle('low', remaining < 2 * MIN);
    const pace = document.getElementById('session-pace');
    if (pace) pace.innerHTML = paceText(s);
  }

  function paceText(s) {
    const open = sessionOpenIds(s);
    if (!open.length) return '';
    const need = open.reduce((sum, id) => sum + S.estimate(task(id)), 0) * MIN;
    const remaining = sessionRemaining(s);
    if (remaining <= 0) return '';
    if (need <= remaining * 0.8) return '🟢 Gut in der Zeit';
    if (need <= remaining * 1.1) return '🟡 Knapp – dranbleiben!';
    return '🔴 Wird eng – nicht alles schaffst du heute';
  }

  function viewSession() {
    const s = state.session;
    const remaining = sessionRemaining(s);
    const pct = Math.max(0, Math.min(100, (remaining / s.durationMs) * 100));
    const open = sessionOpenIds(s);
    const doneSet = new Set(s.doneIds);
    const bonus = new Set(s.bonusIds);
    const added = new Set(s.addedIds || []);
    const extra = sessionExtraIds(s);
    const ids = s.taskIds.filter((id) => task(id));
    // Offene zuerst, Erledigte unten.
    ids.sort((a, b) => (doneSet.has(a) ? 1 : 0) - (doneSet.has(b) ? 1 : 0));

    let banner = '';
    if (s.timeUp) {
      const moveCount = open.filter((id) => !extra.has(id) && !task(id).plantId).length;
      banner = `<div class="session-banner ${moveCount ? 'warn' : 'good'}">
          <strong>⏰ Zeit um!</strong>
          <p>${s.doneIds.length} geschafft${moveCount ? ` · ${moveCount} wandert auf morgen` : ''}.</p>
          <div class="btn-row">
            <button class="btn" data-action="session-extend">+5 Min. weiter</button>
            <button class="btn primary" data-action="session-finish">${moveCount ? 'Beenden & verschieben' : 'Beenden'}</button>
          </div></div>`;
    } else if (s.allDone) {
      banner = `<div class="session-banner good">
          <strong>🎉 Alles geschafft!</strong>
          <p>Für die restliche Zeit passt nichts mehr – genieß die Pause.</p>
          <button class="btn primary block" data-action="session-finish">Fertig</button></div>`;
    }

    return `
      <header class="session-head">
        <div id="session-ring" class="timer-ring ${remaining < 2 * MIN ? 'low' : ''}" style="--p:${pct.toFixed(2)}">
          <div><span id="session-clock" class="clock">${s.timeUp ? '0:00' : fmtClock(remaining)}</span>
          <small>${s.timeUp ? 'Zeit um' : s.pausedAt ? 'Pausiert' : 'verbleibend'}</small></div>
        </div>
        <p class="muted">${s.doneIds.length} erledigt · ${open.length} offen</p>
        <p id="session-pace" class="small">${s.timeUp || s.allDone ? '' : paceText(s)}</p>
        ${s.timeUp || s.allDone ? '' : `<div class="btn-row">
          <button class="btn" data-action="session-pause">${s.pausedAt ? '▶ Weiter' : '⏸ Pause'}</button>
          <button class="btn" data-action="session-end">■ Beenden</button>
        </div>`}
      </header>
      ${banner}
      <ul class="list session-list">${ids.map((id) => {
        const t = task(id);
        const r = room(t.roomId);
        const isDone = doneSet.has(id);
        const willMove = s.timeUp && !isDone && !extra.has(id) && !t.plantId;
        return `<li class="row ${isDone ? 'done' : ''}" data-action="session-toggle" data-id="${id}">
          <span class="check ${isDone ? 'checked' : ''}" aria-hidden="true">${isDone ? '✓' : ''}</span>
          ${taskIcon(t, r)}
          <div class="row-main">
            <div class="row-title">${esc(t.name)}</div>
            ${t.note ? `<div class="row-note">${esc(t.note)}</div>` : ''}
            <div class="row-sub">${r ? esc(r.name) : ''} ·
              ${isDone ? `in ${fmtClock(s.times[id] || 0)} Min.` : `ca. ${fmtMinutes(S.estimate(t))}`}
              ${bonus.has(id) ? '<span class="badge good">Bonus ✨</span>' : ''}
              ${added.has(id) ? '<span class="badge">Dazugenommen</span>' : ''}
              ${task(id).oneOff ? '<span class="badge">Einmalig</span>' : ''}
              ${willMove ? '<span class="badge">→ morgen</span>' : ''}</div>
          </div>
          ${avatar(member(s.memberIds[id]))}
          ${isDone ? '' : `<button class="icon-btn" data-action="session-swap" data-id="${id}" title="Tauschen">⇄</button>`}
        </li>`;
      }).join('')}</ul>
      <div class="btn-row">
        <button class="btn" data-action="session-add">＋ Aufgabe hinzufügen</button>
        <button class="btn" data-action="session-shop">🛒 Etwas ist leer</button>
        ${!s.timeUp && sessionRemaining(s) > 2 * MIN ? '<button class="btn" data-action="session-more">✨ Passende vorschlagen</button>' : ''}
      </div>
      <p class="muted small center">Tipp: Hake jede Aufgabe direkt ab, wenn du fertig bist – so lernt die App, wie lange du wirklich brauchst.</p>`;
  }

  function ensureSessionTimer() {
    const active = state.session && ui.tab === 'today' && !state.session.pausedAt;
    if (active && !sessionTimer) sessionTimer = setInterval(tickSession, 1000);
    if (!active && sessionTimer) { clearInterval(sessionTimer); sessionTimer = null; }
  }


  function addRoomFromTemplate(tpl, stagger) {
    const r = { id: uid(), name: tpl.name, icon: tpl.icon };
    state.rooms.push(r);
    const today = S.today();
    tpl.tasks.forEach(([name, interval, minutes], i) => {
      // Startzustand gestaffelt, damit nicht alles am ersten Tag fällig ist.
      const frac = stagger ? ((i + state.tasks.length) * 0.618034) % 1 : 0;
      state.tasks.push({
        id: uid(), roomId: r.id, name, interval, minutes,
        lastDone: today - Math.round(interval * frac), assignee: null, paused: false, snoozedUntil: null,
      });
      autoFollowUp(state.tasks[state.tasks.length - 1]);
    });
    return r;
  }

  // ---------------------------------------------------------------- Ansichten

  function viewToday() {
    const today = S.today();
    const plan = S.planDays(state, today, 1, doneTodayIds())[0];
    const mine = scopeMine();
    const items = mine ? plan.items.filter((i) => !i.memberId || i.memberId === mine) : plan.items;
    const allDone = state.history.filter((h) => h.day === today && !h.skipped);
    const doneEntries = mine ? allDone.filter((h) => h.memberId === mine) : allDone;
    const plannedIds = new Set(plan.items.map((i) => i.task.id));
    const doneIds = new Set(allDone.map((h) => h.taskId));
    const extra = state.tasks
      .filter((t) => S.isPlannable(t, today, state.settings) && !plannedIds.has(t.id) && !doneIds.has(t.id) && S.urgency(t, today, undefined, state.settings) >= 1
        && (!mine || S.canDo(t, mine, state)))
      .sort((a, b) => S.urgency(b, today, undefined, state.settings) - S.urgency(a, today, undefined, state.settings));

    const doneMin = doneEntries.reduce((s, h) => s + h.minutes, 0);
    const openMin = items.reduce((s, i) => s + S.estimate(i.task), 0);
    const total = doneMin + openMin;
    const pct = total ? Math.round((doneMin / total) * 100) : 100;
    const d = new Date();
    const hour = d.getHours();
    const greet = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';

    let html = `
      ${householdChip()}
      <header class="hero">
        <div>
          <p class="muted">${WEEKDAYS[S.weekday(today)]}, ${d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}</p>
          <h1>${greet}!</h1>
          <p class="muted">${items.length ? `${items.length} Aufgabe${items.length === 1 ? '' : 'n'} · ca. ${fmtMinutes(openMin)}` : 'Für heute ist alles erledigt.'}</p>
          ${streakLine(mine)}
        </div>
        <div class="ring" style="--p:${pct}"><span>${pct}%</span></div>
      </header>
      ${personalScope() ? `<div class="scope-toggle">
        <button class="chip ${mine ? 'on' : ''}" data-action="today-scope" data-scope="mine">${avatar(member(personalScope()))} Meine</button>
        <button class="chip ${mine ? '' : 'on'}" data-action="today-scope" data-scope="all">👥 Alle</button></div>` : ''}`;

    if (state.tasks.length) {
      html += `<button class="btn primary block timer-btn" data-action="session-start">⏱️ Putz-Timer starten</button>`;
    }

    html += updateBanner();
    html += accountHint();
    html += frostHint();

    if (!isStandalone() && !state.settings.installHintDismissed) {
      html += `<div class="hint"><span>📲</span><div class="grow"><strong>Putzplan als App installieren</strong><br>
        <span class="muted small">Mit Symbol auf dem Startbildschirm und täglicher Erinnerung.</span></div>
        <button class="btn primary" data-action="go" data-tab="settings">Los</button>
        <button class="icon-btn" data-action="dismiss-install" title="Ausblenden">✕</button></div>`;
    }

    if (!state.tasks.length) {
      html += `<div class="empty"><p>Noch keine Aufgaben angelegt.</p><button class="btn primary" data-action="go" data-tab="rooms">Räume einrichten</button></div>`;
      return html;
    }

    if (items.length) {
      html += `<section><h2>${mine ? 'Für dich heute' : 'Heute zu tun'}</h2><ul class="list">${items.map((i) => taskRow(i.task, i.memberId, i.early ? 'Vorgezogen' : null)).join('')}</ul></section>`;
    } else {
      html += `<div class="empty big"><div class="emoji">🎉</div><p><strong>Alles sauber!</strong><br>Genieß deinen Tag.</p></div>`;
    }

    html += todayPlantsBlock(doneIds);

    if (extra.length) {
      html += `<section><button class="link" data-action="toggle-more">${ui.showMore ? '▾' : '▸'} Ebenfalls fällig (${extra.length}) – passt nicht mehr ins heutige Zeitbudget</button>
        ${ui.showMore ? `<ul class="list">${extra.map((t) => taskRow(t, t.assignee)).join('')}</ul>` : ''}</section>`;
    }

    if (doneEntries.length) {
      html += `<section><h2>Erledigt</h2><ul class="list">${doneEntries.map((h) => {
        const t = task(h.taskId);
        if (!t) return '';
        const r = room(t.roomId);
        return `<li class="row done"><span class="room-icon">${r ? r.icon : '🧽'}</span>
          <div class="row-main"><div class="row-title">${esc(t.name)}</div><div class="row-sub">${r ? esc(r.name) : ''} · ${fmtMinutes(h.minutes)}</div></div>
          ${avatar(member(h.memberId))}
          <button class="icon-btn" data-action="undo" data-id="${h.id}" title="Rückgängig">↺</button></li>`;
      }).join('')}</ul></section>`;
    }
    return html;
  }

  function taskRow(t, memberId, tag) {
    const r = room(t.roomId);
    const today = S.today();
    const u = S.urgency(t, today, undefined, state.settings);
    const overdue = S.dueDay(t, state.settings) < today;
    return `<li class="row">
      <button class="check" data-action="complete" data-id="${t.id}" data-member="${memberId || ''}" title="Erledigt"></button>
      ${taskIcon(t, r)}
      <div class="row-main" data-action="task-menu" data-id="${t.id}" data-member="${memberId || ''}">
        <div class="row-title">${esc(t.name)}</div>
        ${t.note ? `<div class="row-note">${esc(t.note)}</div>` : ''}
        <div class="row-sub">${r ? esc(r.name) : ''} · ${minutesLabel(t)}${allergyBoosted(t) || t.allergyKey ? ' · 🤧' : ''}
          ${overdue ? `<span class="badge bad">${dueText(t)}</span>` : ''}
          ${tag ? `<span class="badge">${tag}</span>` : ''}</div>
        <div class="dirt"><span style="width:${Math.min(100, u * 100)}%;background:${dirtColor(u)}"></span></div>
      </div>
      ${avatar(member(memberId))}
    </li>`;
  }

  function viewWeek() {
    const today = S.today();
    const plan = S.planDays(state, today, 7, doneTodayIds());
    const totalMin = plan.reduce((s, d) => s + d.minutes, 0);
    return `
      <header class="page-head"><h1>Wochenplan</h1>
        <p class="muted">Automatisch verteilt nach Fälligkeit und deinem Zeitbudget · ${fmtMinutes(totalMin)} diese Woche</p></header>
      ${plan.map((d) => `
        <section class="day-card ${d.day === today ? 'is-today' : ''}">
          <div class="day-head">
            <h2>${dayLabel(d.day)}</h2>
            <span class="muted">${d.budget ? `${fmtMinutes(d.minutes)} / ${fmtMinutes(d.budget)}` : 'Freier Tag'}</span>
          </div>
          ${d.budget ? `<div class="bar"><span style="width:${Math.min(100, (d.minutes / Math.max(1, d.budget)) * 100)}%"></span></div>` : ''}
          ${d.items.length ? `<ul class="mini-list">${d.items.map((i) => {
            const r = room(i.task.roomId);
            return `<li data-action="edit-task" data-id="${i.task.id}"><span>${r ? r.icon : '🧽'}</span><span class="grow">${esc(i.task.name)}<small class="muted"> · ${r ? esc(r.name) : ''}</small></span>${avatar(member(i.memberId))}<small class="muted">${S.estimate(i.task)}′</small></li>`;
          }).join('')}</ul>` : `<p class="muted small">${d.budget ? 'Nichts geplant 🙌' : 'Heute wird nicht geputzt 😌'}</p>`}
        </section>`).join('')}`;
  }

  function viewRooms() {
    const today = S.today();
    if (ui.roomId && room(ui.roomId)) return viewRoom(room(ui.roomId));
    const cards = state.rooms.map((r) => {
      const tasks = state.tasks.filter((t) => t.roomId === r.id && !t.archived && !t.plantId);
      const pct = S.roomCleanliness(tasks, today, state.settings);
      const due = tasks.filter((t) => S.isPlannable(t, today, state.settings) && S.urgency(t, today, undefined, state.settings) >= 1).length;
      return `<button class="room-card" data-action="open-room" data-id="${r.id}">
        <span class="room-emoji">${r.icon}</span>
        ${r.ownerId && member(r.ownerId) ? `<span class="room-owner">${avatar(member(r.ownerId))}</span>` : ''}
        <span class="room-name">${esc(r.name)}</span>
        <span class="muted small">${tasks.length} Aufgaben${due ? ` · <strong class="bad-text">${due} fällig</strong>` : ''}</span>
        <span class="bar"><span style="width:${pct}%;background:${cleanlinessColor(pct)}"></span></span>
        <span class="small">${pct}% sauber</span>
      </button>`;
    }).join('');
    const avg = state.rooms.length
      ? Math.round(state.rooms.reduce((s, r) => s + S.roomCleanliness(state.tasks.filter((t) => t.roomId === r.id), today, state.settings), 0) / state.rooms.length)
      : 100;
    return `
      <header class="page-head"><h1>Räume</h1><p class="muted">Dein Zuhause ist zu <strong>${avg}%</strong> sauber.</p></header>
      <div class="room-grid">${cards}
        <button class="room-card add" data-action="add-room"><span class="room-emoji">＋</span><span class="room-name">Raum hinzufügen</span></button>
      </div>`;
  }

  function viewRoom(r) {
    const today = S.today();
    const tasks = state.tasks.filter((t) => t.roomId === r.id && !t.archived && !t.plantId)
      .sort((a, b) => S.dueDay(a, state.settings) - S.dueDay(b, state.settings));
    const pct = S.roomCleanliness(tasks, today, state.settings);
    return `
      <header class="page-head">
        <button class="link" data-action="close-room">‹ Alle Räume</button>
        <div class="room-title"><span class="room-emoji">${r.icon}</span><h1>${esc(r.name)}</h1>
          <button class="icon-btn" data-action="edit-room" data-id="${r.id}" title="Raum bearbeiten">✎</button></div>
        <div class="bar"><span style="width:${pct}%;background:${cleanlinessColor(pct)}"></span></div>
        <p class="muted">${pct}% sauber</p>
        ${plantsInRoomHint(r)}
      </header>
      <ul class="list">${tasks.map((t) => {
        const u = S.urgency(t, today, undefined, state.settings);
        if (S.robotHandles(t, state.settings)) {
          return `<li class="row robot">
          <span class="check robot-check" aria-hidden="true">🤖</span>
          <div class="row-main" data-action="edit-task" data-id="${t.id}">
            <div class="row-title">${esc(t.name)}</div>
            <div class="row-sub">Macht der ${t && S.floorType(t) === 'mop' ? 'Wischroboter' : 'Saugroboter'} – nicht im Putzplan</div>
          </div>
        </li>`;
        }
        const overdue = !t.paused && S.dueDay(t, state.settings) <= today;
        return `<li class="row ${t.paused ? 'paused' : ''}">
          <button class="check" data-action="complete" data-id="${t.id}" data-member="${t.assignee || ''}" title="Jetzt erledigt"></button>
          <div class="row-main" data-action="edit-task" data-id="${t.id}">
            <div class="row-title">${esc(t.name)}</div>
            <div class="row-sub">${intervalText(t)} · ${minutesLabel(t)} · <span class="${overdue ? 'bad-text' : ''}">${dueText(t)}</span></div>
            <div class="dirt"><span style="width:${Math.min(100, u * 100)}%;background:${dirtColor(u)}"></span></div>
          </div>
          ${avatar(member(t.assignee))}
        </li>`;
      }).join('')}</ul>
      <button class="btn primary block" data-action="add-task" data-room="${r.id}">＋ Aufgabe hinzufügen</button>`;
  }

  /**
   * Serie: Tage am Stück, an denen etwas erledigt wurde (mit `memberId` nur von dieser Person).
   * Freie Tage (kein Zeitbudget) unterbrechen die Serie nicht. Heute zählt erst, wenn etwas
   * erledigt ist – bis dahin hält die Serie von gestern.
   */
  function streakDays(memberId) {
    const days = new Set(state.history.filter((h) => !h.skipped && (!memberId || h.memberId === memberId)).map((h) => h.day));
    const m = memberId && member(memberId);
    const freeDay = (d) => {
      if (m) return S.memberBudget(m, state.settings, d) === 0;
      if (state.members.length) return state.members.every((x) => S.memberBudget(x, state.settings, d) === 0);
      return S.budgetFor(state.settings, d) === 0;
    };
    let d = S.today();
    if (!days.has(d)) d -= 1;
    let n = 0;
    for (let guard = 0; guard < 3650; guard++) {
      if (days.has(d)) n++;
      else if (!freeDay(d)) break;
      d--;
    }
    return n;
  }

  /** Serie oben unter „Heute“. */
  function streakLine(memberId) {
    const n = streakDays(memberId);
    if (!n) return '';
    const today = S.today();
    const doneToday = state.history.some((h) => h.day === today && !h.skipped && (!memberId || h.memberId === memberId));
    const freeToday = memberId ? S.memberBudget(member(memberId), state.settings, today) === 0
      : state.members.length ? state.members.every((x) => S.memberBudget(x, state.settings, today) === 0) : S.budgetFor(state.settings, today) === 0;
    const hint = doneToday || freeToday ? '' : ' · heute dranbleiben!';
    return `<p class="streak">🔥 <strong>${n} Tag${n === 1 ? '' : 'e'}</strong> Serie${hint}</p>`;
  }

  function viewTeam() {
    const today = S.today();
    const weekStart = today - S.weekday(today);
    const real = state.history.filter((h) => !h.skipped);
    const week = real.filter((h) => h.day >= weekStart);
    const month = real.filter((h) => h.day > today - 30);
    const stats = state.members.map((m) => ({
      m,
      week: week.filter((h) => h.memberId === m.id).reduce((s, h) => s + h.minutes, 0),
      month: month.filter((h) => h.memberId === m.id).reduce((s, h) => s + h.minutes, 0),
      count: month.filter((h) => h.memberId === m.id).length,
    })).sort((a, b) => b.week - a.week);
    const maxWeek = Math.max(1, ...stats.map((s) => s.week));
    const recent = real.slice(-15).reverse();

    return `
      <header class="page-head"><button class="link" data-action="go" data-tab="settings">‹ Mehr</button><h1>Team & Statistik</h1></header>
      <div class="stat-grid">
        <div class="stat"><strong>${streakDays()}</strong><span>Tage Serie 🔥</span></div>
        <div class="stat"><strong>${week.length}</strong><span>Aufgaben diese Woche</span></div>
        <div class="stat"><strong>${fmtMinutes(week.reduce((s, h) => s + h.minutes, 0))}</strong><span>geputzt diese Woche</span></div>
      </div>
      <section><h2>Rangliste (Punkte = Minuten)</h2>
        ${stats.length ? `<ul class="list">${stats.map((s, i) => `
          <li class="row" data-action="edit-member" data-id="${s.m.id}">
            <span class="rank">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
            ${avatar(s.m, 'lg')}
            <div class="row-main"><div class="row-title">${esc(s.m.name)}</div>
              <div class="bar"><span style="width:${(s.week / maxWeek) * 100}%;background:${s.m.color}"></span></div>
              <div class="row-sub">${s.week} Pkt. diese Woche · ${s.month} Pkt. / ${s.count} Aufgaben in 30 Tagen</div></div>
          </li>`).join('')}</ul>` : '<p class="muted">Noch keine Mitbewohner angelegt.</p>'}
        <button class="btn block" data-action="add-member">＋ Person hinzufügen</button>
      </section>
      <section><h2>Zuletzt erledigt</h2>
        ${recent.length ? `<ul class="mini-list">${recent.map((h) => {
          const t = task(h.taskId);
          const r = t && room(t.roomId);
          return `<li><span>${r ? r.icon : '🧽'}</span><span class="grow">${t ? esc(t.name) : 'Gelöschte Aufgabe'}<small class="muted"> · ${dayLabel(h.day)}</small></span>${avatar(member(h.memberId))}</li>`;
        }).join('')}</ul>` : '<p class="muted">Noch nichts erledigt – leg los!</p>'}
      </section>`;
  }

  function viewSettings() {
    const b = state.settings.minutesPerWeekday;
    return `
      <header class="page-head"><h1>Mehr</h1></header>
      ${updateCard()}
      ${accountCard()}
      ${householdCard()}
      <section class="card team-card">
        <button class="row" data-action="go" data-tab="team"><span class="room-icon">🏆</span>
          <div class="row-main"><div class="row-title">Team & Statistik</div><div class="row-sub">Rangliste, Punkte, Serie und Verlauf</div></div><span class="muted">›</span></button>
      </section>
      ${installCard()}
      ${reminderCard()}
      ${plantsCard()}
      ${robotCard()}
      ${allergyCard()}
      ${budgetCard(b)}
      <section class="card">
        <h2>Mitglieder</h2>
        <p class="muted small">Wer im Haushalt putzt – auch Personen ohne eigenes Handy, z. B. Kinder.${cloud.user ? ' 🔗 = mit Konto verknüpft.' : ''}</p>
        <ul class="list">${state.members.map((m) => `<li class="row" data-action="edit-member" data-id="${m.id}">${avatar(m, 'lg')}<div class="row-main"><div class="row-title">${esc(m.name)}${m.userId ? ' 🔗' : ''}</div>
          <div class="row-sub">${(m.offDays || []).length ? 'Frei: ' + m.offDays.map((d) => WEEKDAYS_SHORT[d]).join(', ') : 'Jeden Tag verfügbar'}</div></div><span class="muted">›</span></li>`).join('')}</ul>
        <button class="btn block" data-action="add-member">＋ Person hinzufügen</button>
      </section>
      <section class="card">
        <h2>Daten</h2>
        <p class="muted small">${isCloudHousehold() ? 'Dein Haushalt ist in deinem Konto gesichert. Zusätzlich kannst du ihn als Datei exportieren.'
          : 'Alle Daten bleiben auf diesem Gerät. Exportiere sie als Backup oder um sie auf ein anderes Gerät zu übertragen.'}</p>
        <div class="btn-row">
          <button class="btn" data-action="export">⬇︎ Exportieren</button>
          <button class="btn" data-action="import">⬆︎ Importieren</button>
        </div>
        ${isCloudHousehold() ? '' : '<button class="btn danger block" data-action="reset">Alles zurücksetzen</button>'}
      </section>
      <p class="muted small center">Putzplan · funktioniert offline · als App installierbar</p>`;
  }

  /** Zeitbudget: ohne Mitglieder eines für alle, sonst pro Person (ich zuerst). */
  function budgetCard(b) {
    if (!state.members.length) {
      return `<section class="card">
        <h2>Zeitbudget pro Tag</h2>
        <p class="muted small">Wie viele Minuten möchtest du an welchem Tag putzen? Der Plan verteilt die Aufgaben automatisch. 0 = freier Tag.</p>
        <div class="budget-grid">${WEEKDAYS_SHORT.map((w, i) => `
          <label><span>${w}</span><input type="number" min="0" max="600" step="5" value="${b[i]}" data-budget="${i}"></label>`).join('')}</div>
      </section>`;
    }
    const me = myMemberId();
    const people = state.members.slice().sort((x, y) => (y.id === me) - (x.id === me));
    const today = S.today();
    return `<section class="card">
        <h2>Zeitbudget pro Person</h2>
        <p class="muted small">Wie viele Minuten hat jede Person an welchem Tag? Der Plan verteilt die Aufgaben danach. 0 = freier Tag.</p>
        ${people.map((m) => `<div class="budget-person">
          <div class="budget-who">${avatar(m)} <strong>${esc(m.name)}</strong>${m.id === me ? ' <span class="badge">Du</span>' : ''}</div>
          <div class="budget-grid">${WEEKDAYS_SHORT.map((w, i) => `
            <label><span>${w}</span><input type="number" min="0" max="600" step="5" value="${S.memberBudget(Object.assign({}, m, { offDays: [] }), state.settings, today - S.weekday(today) + i)}"
              data-budget="${i}" data-budget-member="${m.id}"></label>`).join('')}</div></div>`).join('')}
      </section>`;
  }

  function viewOnboarding() {
    const step = ui.onboardStep || 1;
    if (step === 1) {
      const sel = ui.onboardRooms || new Set(['kitchen', 'bath', 'living', 'bedroom', 'hall', 'general']);
      ui.onboardRooms = sel;
      return `
        <div class="onboard">
          <div class="emoji big-emoji">${ui.newHousehold ? '🏡' : '🧹'}</div>
          <h1>${ui.newHousehold ? 'Neuen Haushalt einrichten' : 'Willkommen bei Putzplan'}</h1>
          <p class="muted">Welche Räume hat dein Zuhause? Wir legen passende Aufgaben mit sinnvollen Intervallen an – anpassen kannst du alles später.</p>
          <div class="chip-grid">${T.ROOM_TEMPLATES.map((r) => `
            <button class="chip ${sel.has(r.key) ? 'on' : ''}" data-action="toggle-template" data-key="${r.key}">${r.icon} ${r.name}</button>`).join('')}</div>
          <button class="btn primary block" data-action="onboard-next" ${sel.size ? '' : 'disabled'}>Weiter</button>
          ${!cloud.user && !ui.newHousehold && Cloud && Cloud.available() ? '<button class="link center-link" data-action="onboard-welcome-login">Schon ein Konto? Anmelden</button>' : ''}
          ${!ui.newHousehold && Cloud && Cloud.available() ? '<button class="link center-link" data-action="onboard-join">Einladung bekommen? Mit Code beitreten</button>' : ''}
        </div>`;
    }
    if (step === 4) {
      return `
        <div class="onboard">
          <div class="emoji big-emoji">☁️</div>
          <h1>Konto anlegen?</h1>
          <p class="muted">Mit einem Konto ist dein Putzplan gesichert, und du kannst ihn mit deinem Haushalt teilen –
            jede Person auf ihrem eigenen Handy. Kein Passwort nötig.</p>
          <button class="btn primary block" data-action="onboard-login">Konto anlegen (E-Mail oder Google)</button>
          <button class="btn block" data-action="onboard-finish">Ohne Konto weiter</button>
          <p class="small muted">Ohne Konto liegen deine Daten nur auf diesem Handy. Wenn du die App löschst,
            das Handy verlierst oder wechselst, sind sie weg.</p>
        </div>`;
    }
    if (step === 2) {
      const names = ui.onboardMembers || [cloud.user ? userName() : ''];
      ui.onboardMembers = names;
      return `
        <div class="onboard">
          <div class="emoji big-emoji">👥</div>
          <h1>Wer putzt mit?</h1>
          <p class="muted">Trage alle Personen ein. Aufgaben werden fair verteilt und es gibt eine Rangliste.</p>
          ${names.map((n, i) => `<input class="input" placeholder="${i === 0 ? 'Dein Name' : 'Name'}" value="${esc(n)}" data-member-name="${i}">`).join('')}
          <button class="link" data-action="onboard-add-member">＋ Weitere Person</button>
          <button class="btn primary block" data-action="onboard-next">Weiter</button>
        </div>`;
    }
    const minutes = ui.onboardMinutes || 20;
    ui.onboardMinutes = minutes;
    return `
      <div class="onboard">
        <div class="emoji big-emoji">⏱️</div>
        <h1>Wie viel Zeit hast du?</h1>
        <p class="muted">Pro Werktag – am Samstag planen wir das Dreifache ein, der Sonntag bleibt frei. Das kannst du später für jeden Tag einzeln ändern.</p>
        <div class="slider-val"><strong id="min-val">${minutes}</strong> Minuten pro Tag</div>
        <input type="range" min="5" max="120" step="5" value="${minutes}" data-onboard-minutes class="slider">
        <div class="onboard-robot">
          <p><strong>🤖 Hast du einen Roboter?</strong><br><span class="muted small">Dann lassen wir Saugen bzw. Wischen weg.</span></p>
          <label class="switch-row"><span>Saugroboter</span><input type="checkbox" class="switch" data-onboard-robot="vacuum" ${ui.onboardRobot && ui.onboardRobot.vacuum ? 'checked' : ''}></label>
          <label class="switch-row"><span>Wischroboter</span><input type="checkbox" class="switch" data-onboard-robot="mop" ${ui.onboardRobot && ui.onboardRobot.mop ? 'checked' : ''}></label>
        </div>
        <div class="onboard-robot">
          <p><strong>🤧 Allergien im Haushalt?</strong><br><span class="muted small">Dann planen wir Bettwäsche, Polster & Co. öfter ein.</span></p>
          <div class="chip-grid">${T.ALLERGIES.map((x) => `<button class="chip ${(ui.onboardAllergy || []).includes(x.key) ? 'on' : ''}" data-action="onboard-allergy" data-key="${x.key}">${x.icon} ${x.name}</button>`).join('')}</div>
        </div>
        <button class="btn primary block" data-action="${!cloud.user && !ui.newHousehold && Cloud && Cloud.available() ? 'onboard-next' : 'onboard-finish'}">Putzplan erstellen ✨</button>
      </div>`;
  }

  // ---------------------------------------------------------------- Modals

  function openModal(html, onMount) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-backdrop" data-close></div><div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    root.querySelector('[data-close]').onclick = closeModal;
    if (onMount) onMount(root.querySelector('.modal'));
  }

  function closeModal() {
    document.getElementById('modal-root').innerHTML = '';
  }

  function memberOptions(selected, emptyLabel) {
    return `<option value="">${emptyLabel}</option>` + state.members.map((m) => `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  }

  function taskMenu(taskId, memberId) {
    const t = task(taskId);
    const others = state.members.filter((m) => m.id !== memberId);
    openModal(`
      <h2>${esc(t.name)}</h2>
      <p class="muted">${dueText(t)} · ${t.plantId ? `zurzeit ${intervalLabel(t.interval)}` : intervalLabel(t.interval)}</p>
      <div class="menu">
        <button data-m="done">✅ Erledigt${member(memberId) ? ` (${esc(member(memberId).name)})` : ''}</button>
        ${others.map((m) => `<button data-m="done-by" data-member="${m.id}">✅ Erledigt von ${esc(m.name)}</button>`).join('')}
        <button data-m="snooze1">⏰ Auf morgen verschieben</button>
        <button data-m="snooze3">⏰ Um 3 Tage verschieben</button>
        ${t.plantId ? '' : '<button data-m="skip">⏭️ Diesmal überspringen</button>'}
        <button data-m="shop">🛒 Auf die Einkaufsliste</button>
        <button data-m="edit">✎ ${t.plantId ? 'Pflanze bearbeiten' : 'Bearbeiten'}</button>
        <button data-m="cancel" class="muted">Abbrechen</button>
      </div>`, (el) => {
      el.querySelectorAll('[data-m]').forEach((b) => {
        b.onclick = () => {
          const m = b.dataset.m;
          closeModal();
          if (m === 'done') completeTask(taskId, memberId);
          if (m === 'done-by') completeTask(taskId, b.dataset.member);
          if (m === 'snooze1') snoozeTask(taskId, 1);
          if (m === 'snooze3') snoozeTask(taskId, 3);
          if (m === 'skip') skipTask(taskId);
          if (m === 'edit') editTask(taskId);
          if (m === 'shop') shopQuickDialog('Für „' + t.name + '“', Sh.suggestionsFor(t.name));
        };
      });
    });
  }

  function followUpFields(t) {
    const f = t.id ? followUpsOf(t.id)[0] : null;
    const delay = f ? f.trigger.delayDays : 1;
    return `<details class="follow" ${f ? 'open' : ''}>
        <summary>↪ Folgeaufgabe ${f ? `: ${esc(f.name)}` : '(optional)'}</summary>
        <p class="small muted">Wird fällig, nachdem du diese Aufgabe erledigt hast – z. B. „Wäsche abnehmen“ nach „Wäsche aufhängen“.</p>
        <label>Danach zu tun<input class="input" name="followName" value="${f ? esc(f.name) : ''}" placeholder="z. B. Wäsche abnehmen"></label>
        <label>Fällig<select class="input" name="followDelay">${DELAY_LABELS.map((l, i) => `<option value="${i}" ${i === delay ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </details>`;
  }

  function editTask(taskId, roomId) {
    if (taskId && task(taskId) && task(taskId).plantId) { editPlant(task(taskId).plantId); return; }
    const t = taskId ? task(taskId) : { name: '', interval: 7, minutes: 10, roomId, assignee: null, paused: false };
    const presetMatch = T.INTERVALS.some(([d]) => d === t.interval);
    openModal(`
      <h2>${taskId ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}</h2>
      <form id="task-form" class="form">
        <label>Was ist zu tun?<input class="input" name="name" required value="${esc(t.name)}" placeholder="z. B. Fenster putzen"></label>
        <label>Raum<select class="input" name="roomId">${state.rooms.map((r) => `<option value="${r.id}" ${r.id === t.roomId ? 'selected' : ''}>${r.icon} ${esc(r.name)}</option>`).join('')}</select></label>
        ${t.trigger ? `
        <input type="hidden" name="intervalPreset" value="${t.interval}">
        <p class="small learned">↪ Folgeaufgabe von „${esc((task(t.trigger.afterTaskId) || { name: '?' }).name)}“ – wird fällig, sobald diese erledigt ist.</p>
        <label>Fällig<select class="input" name="delay">${DELAY_LABELS.map((l, i) => `<option value="${i}" ${i === t.trigger.delayDays ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : `
        <label>Wie oft?<select class="input" name="intervalPreset">
          ${T.INTERVALS.map(([d, l]) => `<option value="${d}" ${d === t.interval ? 'selected' : ''}>${l}</option>`).join('')}
          <option value="custom" ${presetMatch ? '' : 'selected'}>Eigenes Intervall…</option></select></label>
        <label class="custom-interval" ${presetMatch ? 'hidden' : ''}>Alle … Tage<input class="input" type="number" min="1" max="730" name="interval" value="${t.interval}"></label>`}
        <label>Dauer (Minuten)<input class="input" type="number" min="1" max="480" name="minutes" value="${t.minutes}"></label>
        ${t.learnedMinutes ? `<p class="small learned">⏱ Gelernt aus ${t.durations.length} Messung${t.durations.length === 1 ? '' : 'en'}: du brauchst ca. <strong>${fmtMinutes(t.learnedMinutes)}</strong>.
          Der Plan rechnet damit. Änderst du die Dauer oben, wird neu gelernt.</p>` : ''}
        ${robotEnabled() ? `<label>Bodenreinigung<select class="input" name="floor">
          ${[['', 'Keine Bodenaufgabe'], ['vacuum', 'Staubsaugen (Saugroboter)'], ['mop', 'Boden wischen (Wischroboter)']]
            .map(([v, l]) => `<option value="${v}" ${S.floorType(t) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
        ${state.members.length ? `<label>Zuständig<select class="input" name="assignee">${memberOptions(t.assignee, (room(t.roomId) && member(room(t.roomId).ownerId)) ? `Wem der Raum gehört (${esc(member(room(t.roomId).ownerId).name)})` : 'Automatisch verteilen')}</select></label>` : ''}
        ${t.trigger ? '' : followUpFields(t)}
        ${taskId ? `<label class="check-label"><input type="checkbox" name="paused" ${t.paused ? 'checked' : ''}> Pausieren (z. B. im Urlaub)</label>` : t.trigger ? '' : `
          <label>Zuletzt erledigt<select class="input" name="last">
            <option value="0">Gerade eben</option><option value="half" selected>Ist mal wieder dran</option><option value="due">Sofort fällig</option></select></label>`}
        <div class="btn-row">
          ${taskId ? '<button type="button" class="btn danger" data-del>Löschen</button>' : ''}
          <button type="button" class="btn" data-cancel>Abbrechen</button>
          <button type="submit" class="btn primary">Speichern</button>
        </div>
      </form>`, (el) => {
      const form = el.querySelector('form');
      form.intervalPreset.onchange = () => {
        const custom = el.querySelector('.custom-interval');
        if (custom) custom.hidden = form.intervalPreset.value !== 'custom';
      };
      el.querySelector('[data-cancel]').onclick = closeModal;
      const del = el.querySelector('[data-del]');
      if (del) del.onclick = () => {
        if (!confirm(`„${t.name}“ wirklich löschen?`)) return;
        const follow = new Set(followUpsOf(taskId).map((f) => f.id));
        state.tasks = state.tasks.filter((x) => x.id !== taskId && !follow.has(x.id));
        save(); closeModal(); render();
      };
      form.onsubmit = (ev) => {
        ev.preventDefault();
        const interval = form.intervalPreset.value === 'custom' ? parseInt(form.interval.value, 10) : parseInt(form.intervalPreset.value, 10);
        const data = {
          name: form.name.value.trim(),
          roomId: form.roomId.value,
          interval: Math.max(1, interval || 7),
          minutes: Math.max(1, parseInt(form.minutes.value, 10) || 10),
          assignee: form.assignee ? form.assignee.value || null : null,
        };
        if (!data.name) return;
        if (form.floor) data.floor = form.floor.value;
        let saved = t;
        if (taskId) {
          if (data.minutes !== t.minutes) { delete t.learnedMinutes; delete t.durations; }
          Object.assign(t, data, { paused: form.paused.checked });
          if (t.trigger && form.delay) t.trigger.delayDays = parseInt(form.delay.value, 10) || 0;
        } else {
          const today = S.today();
          const last = form.last.value === '0' ? today : form.last.value === 'due' ? today - data.interval : today - Math.ceil(data.interval / 2);
          saved = Object.assign({ id: uid(), lastDone: last, paused: false, snoozedUntil: null }, data);
          state.tasks.push(saved);
        }
        if (form.followName) {
          const fname = form.followName.value.trim();
          const hadFollowUp = followUpsOf(saved.id).length > 0;
          if (fname || hadFollowUp) setFollowUp(saved, fname, parseInt(form.followDelay.value, 10) || 0);
          // Neue Aufgabe ohne eigene Angabe: bekannte Paare (Wäsche aufhängen → abnehmen) einrichten.
          else if (!taskId) autoFollowUp(saved);
        }
        save(); closeModal(); render();
      };
    });
  }

  function addRoom() {
    const used = new Set(state.rooms.map((r) => r.name));
    openModal(`
      <h2>Raum hinzufügen</h2>
      <p class="muted small">Vorlage wählen – mit typischen Aufgaben:</p>
      <div class="chip-grid">${T.ROOM_TEMPLATES.map((r) => `<button class="chip ${used.has(r.name) ? 'dim' : ''}" data-tpl="${r.key}">${r.icon} ${r.name}</button>`).join('')}</div>
      <p class="muted small">…oder einen leeren Raum anlegen:</p>
      <button class="btn block" data-blank>＋ Leerer Raum</button>`, (el) => {
      el.querySelectorAll('[data-tpl]').forEach((b) => {
        b.onclick = () => {
          const tpl = T.ROOM_TEMPLATES.find((x) => x.key === b.dataset.tpl);
          const r = addRoomFromTemplate(tpl, true);
          save(); closeModal(); ui.roomId = r.id; render();
        };
      });
      el.querySelector('[data-blank]').onclick = () => { closeModal(); editRoom(null); };
    });
  }

  function editRoom(roomId) {
    const r = roomId ? room(roomId) : { name: '', icon: '🏠' };
    openModal(`
      <h2>${roomId ? 'Raum bearbeiten' : 'Neuer Raum'}</h2>
      <form class="form">
        <label>Name<input class="input" name="name" required value="${esc(r.name)}"></label>
        ${state.members.length > 1 ? `<label>Gehört<select class="input" name="ownerId">${memberOptions(r.ownerId, 'Allen (gemeinsam)')}</select></label>
          <p class="small muted">Gehört der Raum einer Person, gehen seine Aufgaben nur an sie – hat sie keine Zeit, warten sie.</p>` : ''}
        <div class="icon-grid">${T.ROOM_ICONS.map((i) => `<button type="button" class="icon-pick ${i === r.icon ? 'on' : ''}" data-icon="${i}">${i}</button>`).join('')}</div>
        <div class="btn-row">
          ${roomId ? '<button type="button" class="btn danger" data-del>Löschen</button>' : ''}
          <button type="button" class="btn" data-cancel>Abbrechen</button>
          <button type="submit" class="btn primary">Speichern</button>
        </div>
      </form>`, (el) => {
      let icon = r.icon;
      el.querySelectorAll('[data-icon]').forEach((b) => {
        b.onclick = () => {
          icon = b.dataset.icon;
          el.querySelectorAll('[data-icon]').forEach((x) => x.classList.toggle('on', x === b));
        };
      });
      el.querySelector('[data-cancel]').onclick = closeModal;
      const del = el.querySelector('[data-del]');
      if (del) del.onclick = () => {
        if (!confirm(`„${r.name}“ und alle Aufgaben darin löschen?`)) return;
        state.rooms = state.rooms.filter((x) => x.id !== roomId);
        state.tasks = state.tasks.filter((t) => t.roomId !== roomId);
        // Pflanzen bleiben erhalten – sie stehen danach ohne Raum da.
        (state.plants || []).forEach((p) => { if (p.roomId === roomId) p.roomId = null; });
        syncPlants();
        ui.roomId = null;
        save(); closeModal(); render();
      };
      el.querySelector('form').onsubmit = (ev) => {
        ev.preventDefault();
        const name = ev.target.name.value.trim();
        if (!name) return;
        const ownerId = ev.target.ownerId ? ev.target.ownerId.value || null : r.ownerId || null;
        if (roomId) Object.assign(r, { name, icon, ownerId });
        else { const nr = { id: uid(), name, icon, ownerId }; state.rooms.push(nr); ui.roomId = nr.id; }
        save(); closeModal(); render();
      };
    });
  }

  function editMember(memberId) {
    const m = memberId ? member(memberId) : { name: '', color: T.MEMBER_COLORS[state.members.length % T.MEMBER_COLORS.length], offDays: [] };
    openModal(`
      <h2>${memberId ? 'Person bearbeiten' : 'Person hinzufügen'}</h2>
      <form class="form">
        <label>Name<input class="input" name="name" required value="${esc(m.name)}"></label>
        <div class="color-row">${T.MEMBER_COLORS.map((c) => `<button type="button" class="color-pick ${c === m.color ? 'on' : ''}" style="background:${c}" data-color="${c}" aria-label="Farbe ${c}"></button>`).join('')}</div>
        <p class="small muted">An diesen Tagen keine Aufgaben zuteilen:</p>
        <div class="chip-grid">${WEEKDAYS_SHORT.map((w, i) => `<label class="chip ${(m.offDays || []).includes(i) ? 'on' : ''}"><input type="checkbox" value="${i}" ${(m.offDays || []).includes(i) ? 'checked' : ''} hidden>${w}</label>`).join('')}</div>
        <div class="btn-row">
          ${memberId ? '<button type="button" class="btn danger" data-del>Entfernen</button>' : ''}
          <button type="button" class="btn" data-cancel>Abbrechen</button>
          <button type="submit" class="btn primary">Speichern</button>
        </div>
      </form>`, (el) => {
      let color = m.color;
      el.querySelectorAll('[data-color]').forEach((b) => {
        b.onclick = () => { color = b.dataset.color; el.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b)); };
      });
      el.querySelectorAll('label.chip input').forEach((cb) => {
        cb.onchange = () => cb.parentElement.classList.toggle('on', cb.checked);
      });
      el.querySelector('[data-cancel]').onclick = closeModal;
      const del = el.querySelector('[data-del]');
      if (del) del.onclick = () => {
        if (!confirm(`${m.name} entfernen?`)) return;
        state.members = state.members.filter((x) => x.id !== memberId);
        state.tasks.forEach((t) => { if (t.assignee === memberId) t.assignee = null; });
        state.rooms.forEach((r) => { if (r.ownerId === memberId) r.ownerId = null; });
        save(); closeModal(); render();
      };
      el.querySelector('form').onsubmit = (ev) => {
        ev.preventDefault();
        const name = ev.target.name.value.trim();
        if (!name) return;
        const offDays = [...el.querySelectorAll('label.chip input:checked')].map((x) => parseInt(x.value, 10));
        if (memberId) Object.assign(m, { name, color, offDays });
        else state.members.push({ id: uid(), name, color, offDays });
        save(); closeModal(); render();
      };
    });
  }

  // ---------------------------------------------------------------- App-Updates (Android)
  //
  // Neue Versionen werden von GitHub Actions als Release veröffentlicht. Die App
  // fragt höchstens alle paar Stunden nach, ob es eine neuere gibt, und lädt die
  // APK auf Wunsch im Browser herunter – installiert wird sie über die alte,
  // die Daten bleiben erhalten.

  const RELEASES_API = 'https://api.github.com/repos/daviddistl-boop/Putzplan/releases/latest';
  const APK_URL = 'https://github.com/daviddistl-boop/Putzplan/releases/latest/download/Putzplan.apk';
  const UPDATE_KEY = 'putzplan.update';
  const UPDATE_EVERY_MS = 6 * 3600 * 1000;

  // Bleibt beim Zurücksetzen der Oberfläche (ui) erhalten.
  const upd = { release: null, version: null, checking: false };

  const buildOf = (tag) => parseInt(String(tag || '').split('.').pop(), 10) || 0;

  /** Neuheiten aus dem Release-Text (Abschnitt „Neu in dieser Version“). */
  function releaseNotes(body) {
    const part = String(body || '').split(/#+\s*Neu in dieser Version/i)[1];
    if (!part) return [];
    return part.split('\n').map((l) => l.replace(/^[-*]\s*/, '').trim())
      .filter((l) => l && !/^(Co-Authored-By|Claude-Session):/i.test(l)).slice(0, 8);
  }

  async function checkForUpdate(force) {
    if (!Native.isNative || !Native.appInfo) return;
    const info = await Native.appInfo();
    if (!info) return;
    upd.version = info.version;
    const current = parseInt(info.build, 10) || buildOf(info.version);
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(UPDATE_KEY) || 'null'); } catch (e) { /* ignorieren */ }
    let release = cached && cached.release;
    if (force || !cached || Date.now() - cached.at > UPDATE_EVERY_MS) {
      upd.checking = true;
      if (force) render();
      try {
        const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const asset = (data.assets || []).find((a) => /\.apk$/i.test(a.name));
        release = { tag: data.tag_name, notes: releaseNotes(data.body), url: asset ? asset.browser_download_url : APK_URL };
        try { localStorage.setItem(UPDATE_KEY, JSON.stringify({ at: Date.now(), release })); } catch (e) { /* ignorieren */ }
      } catch (e) {
        if (force) toast('Konnte nicht nach Updates suchen – bist du online?');
      } finally {
        upd.checking = false;
      }
    }
    const before = upd.release && upd.release.tag;
    upd.release = release && buildOf(release.tag) > current ? release : null;
    if (force && !upd.release) toast(`Du hast die neueste Version (${info.version}) 👍`);
    if (force || (upd.release && upd.release.tag) !== before) render();
  }

  function installUpdate() {
    if (!upd.release) return;
    toast('Download startet im Browser – danach die Datei öffnen und „Aktualisieren“ tippen.');
    // Externe Adressen öffnet die Android-App im Browser, der die APK herunterlädt.
    setTimeout(() => { window.location.href = upd.release.url; }, 600);
  }

  function updateBanner() {
    if (!upd.release) return '';
    return `<div class="hint update"><span>⬆️</span><div class="grow"><strong>Update ${esc(upd.release.tag.replace(/^v/, ''))} verfügbar</strong><br>
        <span class="muted small">${upd.release.notes.length ? esc(upd.release.notes[0]) : 'Neue Version von Putzplan'}</span></div>
        <button class="btn primary" data-action="update-install">Installieren</button></div>`;
  }

  function updateCard() {
    if (!Native.isNative) return '';
    const u = upd.release;
    return `<section class="card">
        <h2>⬆️ App-Version</h2>
        <p class="small">Installiert: <strong>${esc(upd.version || '…')}</strong>${u ? ` · Neu: <strong>${esc(u.tag.replace(/^v/, ''))}</strong>` : ''}</p>
        ${u && u.notes.length ? `<ul class="small notes">${u.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        ${u ? '<button class="btn primary block" data-action="update-install">Update herunterladen & installieren</button>'
          : `<button class="btn block" data-action="update-check" ${upd.checking ? 'disabled' : ''}>${upd.checking ? 'Suche …' : 'Nach Updates suchen'}</button>`}
        <p class="muted small">Updates werden einfach über die installierte App installiert – deine Daten bleiben erhalten.</p>
      </section>`;
  }

  // ---------------------------------------------------------------- Konto & Haushalte
  //
  // Ohne Konto bleibt alles auf dem Handy (Haushalt „local“). Mit Konto gehören die Daten zu
  // einem oder mehreren Haushalten auf dem Server und werden zwischen den Geräten abgeglichen
  // (Regeln in sync.js). Persönliches wie Timer oder Erinnerungszeit bleibt auf dem Gerät.

  const cloud = {
    user: null,
    households: [],   // [{ id, name, icon, role, memberId }]
    members: [],      // Mitgliedschaften des aktiven Haushalts (Konten)
    status: 'idle',   // idle | syncing | ok | offline
    lastSync: null,
    unsubscribe: null,
  };
  const HOUSEHOLD_ICONS = ['🏠', '🏡', '🏢', '🏖️', '🏔️', '🌲', '🛖', '🏰'];
  let syncTimer = null;
  let syncing = false;
  let syncAgain = false;
  let pendingRender = false;

  try { cloud.households = JSON.parse(lsGet(HOUSEHOLDS_KEY) || '[]'); } catch (e) { cloud.households = []; }

  const isCloudHousehold = () => activeId !== 'local';

  /** Server-Aktion mit Fehlermeldung in Klartext. */
  async function cloudTask(fn) {
    ui.cloudBusy = true;
    try {
      await fn();
    } catch (e) {
      console.warn(e);
      toast(Cloud.friendly(e));
    } finally {
      ui.cloudBusy = false;
      render();
    }
  }
  const activeHousehold = () => cloud.households.find((h) => h.id === activeId) || null;
  const metaKey = (id) => `putzplan.sync.${id}`;

  function userName() {
    const u = cloud.user;
    if (!u) return '';
    const md = u.user_metadata || {};
    return md.name || md.full_name || (u.email || '').split('@')[0];
  }

  /** Mein Mitglied im Team des aktiven Haushalts. */
  function myMemberId() {
    if (!cloud.user) return null;
    const linked = state.members.find((m) => m.userId === cloud.user.id);
    if (linked) return linked.id;
    const h = activeHousehold();
    return h && h.memberId && member(h.memberId) ? h.memberId : null;
  }

  function loadMeta(id) {
    try {
      const m = JSON.parse(lsGet(metaKey(id)) || 'null');
      if (m && m.shadow) return m;
    } catch (e) { /* neu anfangen */ }
    return { shadow: {}, cursor: null };
  }

  function saveMeta(id, meta) {
    lsSet(metaKey(id), JSON.stringify(meta));
  }

  function scheduleSync(delay) {
    if (!isCloudHousehold() || !cloud.user) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, delay === undefined ? 1200 : delay);
  }

  /** Neu zeichnen – aber nicht, während jemand in der Ansicht tippt. */
  function softRender() {
    const a = document.activeElement;
    if (a && a.closest && a.closest('#view') && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { pendingRender = true; return; }
    pendingRender = false;
    render();
  }

  /** Abgleich: erst Änderungen holen und einführen, dann eigene Änderungen hochladen. */
  async function syncNow() {
    if (!isCloudHousehold() || !cloud.user) return;
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    const hid = activeId;
    const before = cloud.status;
    cloud.status = 'syncing';
    try {
      const meta = loadMeta(hid);
      const rows = await Cloud.pull(hid, meta.cursor);
      if (hid !== activeId) return;
      let changed = false;
      if (rows.length) {
        const docs = SyncL.stateToDocs(state);
        const res = SyncL.applyRemote(docs, meta.shadow, rows);
        if (res.cursor) meta.cursor = res.cursor;
        if (res.changed) {
          state = SyncL.docsToState(docs, state);
          if (state.rooms.length || state.tasks.length || state.members.length) state.onboarded = true;
          changed = true;
        }
      }
      // Dieselbe Aufgabe auf zwei Handys abgehakt: das erste Abhaken zählt.
      const removed = SyncL.dedupeCompletions(state.history);
      for (const h of removed) {
        if (h.dev !== deviceId) continue;
        const first = state.history.find((x) => x.taskId === h.taskId && x.day === h.day && !x.skipped);
        const who = first && member(first.memberId);
        const t = task(h.taskId);
        toast(`${t ? `„${t.name}“` : 'Die Aufgabe'} war schon erledigt${who ? ` von ${who.name}` : ''} ✓`);
      }
      if (changed || removed.length) {
        migrate();
        syncPlants();
        persist();
      }
      const docs = SyncL.stateToDocs(state);
      const changes = SyncL.diff(meta.shadow, docs);
      const out = SyncL.toRows(changes);
      if (out.length) {
        await Cloud.push(hid, out);
        for (const u of changes.upserts) meta.shadow[u.key] = u.json;
        for (const d of changes.deletes) meta.shadow[d.key] = null;
      }
      saveMeta(hid, meta);
      cloud.status = 'ok';
      cloud.lastSync = Date.now();
      if (changed || removed.length || before !== 'ok') softRender();
    } catch (e) {
      console.warn('Abgleich fehlgeschlagen', e);
      cloud.status = 'offline';
      if (before !== 'offline') softRender();
      // Später nochmal versuchen.
      clearTimeout(syncTimer);
      syncTimer = setTimeout(syncNow, 30000);
    } finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; scheduleSync(300); }
    }
  }

  function subscribeActive() {
    if (cloud.unsubscribe) { cloud.unsubscribe(); cloud.unsubscribe = null; }
    if (!isCloudHousehold() || !cloud.user) return;
    try {
      cloud.unsubscribe = Cloud.subscribe(activeId, (what) => {
        if (what === 'members') refreshMembers();
        else scheduleSync(400);
      });
    } catch (e) { /* ohne Live-Abgleich weiter – beim Öffnen wird abgeglichen */ }
  }

  async function refreshHouseholds() {
    if (!cloud.user) return;
    try {
      cloud.households = await Cloud.households(cloud.user.id);
      lsSet(HOUSEHOLDS_KEY, JSON.stringify(cloud.households));
    } catch (e) { /* offline: zwischengespeicherte Liste */ }
  }

  async function refreshMembers() {
    if (!isCloudHousehold() || !cloud.user) return;
    try {
      cloud.members = await Cloud.members(activeId);
      softRender();
    } catch (e) { /* offline */ }
  }

  /** Zu einem anderen Haushalt wechseln (Daten des bisherigen bleiben auf dem Gerät). */
  async function switchHousehold(id, opts) {
    const o = opts || {};
    if (id !== activeId) {
      persist();
      if (state.session) state.session = null;
      activeId = id;
      lsSet(ACTIVE_KEY, id);
      state = load(id);
      migrate();
      cloud.members = [];
      ui = { tab: o.tab || 'today', roomId: null, showMore: false };
    }
    subscribeActive();
    render();
    if (id !== 'local' && cloud.user) {
      await syncNow();
      refreshMembers();
    }
  }

  /** Eigene Daten eines Haushalts vom Gerät entfernen (nach Verlassen, Abmelden …). */
  function forgetHousehold(id) {
    try {
      localStorage.removeItem(stateKey(id));
      localStorage.removeItem(metaKey(id));
    } catch (e) { /* egal */ }
    cloud.households = cloud.households.filter((h) => h.id !== id);
    lsSet(HOUSEHOLDS_KEY, JSON.stringify(cloud.households));
  }

  /** Nach dem Verlassen/Löschen: in einen anderen Haushalt wechseln oder neu einrichten. */
  async function afterHouseholdGone(id) {
    forgetHousehold(id);
    if (cloud.households.length) {
      await switchHousehold(cloud.households[0].id);
    } else {
      activeId = 'local';
      lsSet(ACTIVE_KEY, 'local');
      state = defaultState();
      ui = { tab: 'today', roomId: null, showMore: false };
      subscribeActive();
      render();
    }
  }

  // ------------------------------------------------ Anmelden

  const LOGIN_CONTEXT_KEY = 'putzplan.loginContext';

  /** Anmelde-Dialog: E-Mail mit Code oder Google. `context` bestimmt, was danach passiert. */
  function loginDialog(context) {
    try { sessionStorage.setItem(LOGIN_CONTEXT_KEY, context || 'settings'); } catch (e) { /* egal */ }
    if (!Cloud || !Cloud.available()) { toast('Keine Verbindung zum Server – bitte später nochmal versuchen.'); return; }
    const step = { email: '', sent: false, busy: false, error: '' };
    const draw = () => openModal(step.sent ? `
      <h2>📬 Code eingeben</h2>
      <p class="muted">Wir haben dir einen Code an <strong>${esc(step.email)}</strong> geschickt. Schau auch im Spam-Ordner nach.</p>
      <div class="form">
        <input class="input code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456" data-code>
        ${step.error ? `<p class="small bad-text">${esc(step.error)}</p>` : ''}
        <button class="btn primary block" data-verify ${step.busy ? 'disabled' : ''}>${step.busy ? 'Prüfe …' : 'Anmelden'}</button>
        <div class="btn-row"><button class="btn" data-back>‹ Andere E-Mail</button><button class="btn" data-resend>Code nochmal schicken</button></div>
      </div>` : `
      <h2>☁️ Anmelden oder Konto anlegen</h2>
      <p class="muted">Mit einem Konto ist dein Putzplan gesichert und du kannst ihn mit anderen teilen. Kein Passwort nötig.</p>
      <div class="form">
        <button class="btn block google-btn" data-google>${GOOGLE_ICON} Mit Google anmelden</button>
        <p class="or">oder mit E-Mail</p>
        <input class="input" type="email" inputmode="email" autocomplete="email" placeholder="deine@email.de" data-email value="${esc(step.email)}">
        ${step.error ? `<p class="small bad-text">${esc(step.error)}</p>` : ''}
        <button class="btn primary block" data-send ${step.busy ? 'disabled' : ''}>${step.busy ? 'Sende …' : 'Code per E-Mail schicken'}</button>
        <button class="btn block" data-cancel>Abbrechen</button>
      </div>`, (el) => {
      const run = async (fn) => {
        step.busy = true; step.error = ''; draw();
        try { await fn(); } catch (e) { step.error = Cloud.friendly(e); }
        step.busy = false;
        if (!step.done && document.querySelector('#modal-root .modal')) draw();
      };
      const send = () => run(async () => {
        const email = (el.querySelector('[data-email]') || {}).value || step.email;
        if (!/^\S+@\S+\.\S+$/.test(email.trim())) throw new Error('Bitte gib eine gültige E-Mail-Adresse ein.');
        step.email = email.trim();
        await Cloud.sendCode(step.email);
        step.sent = true;
      });
      const g = el.querySelector('[data-google]');
      if (g) g.onclick = () => {
        if (!Cloud.googleReady()) { step.error = 'Die Google-Anmeldung wird gerade eingerichtet – bitte nimm vorerst die E-Mail.'; draw(); return; }
        run(async () => {
          const s = await Cloud.googleSignIn();
          if (s) { step.done = true; closeModal(); signedIn(s.user); }
        });
      };
      const sendBtn = el.querySelector('[data-send]');
      if (sendBtn) sendBtn.onclick = send;
      const emailInput = el.querySelector('[data-email]');
      if (emailInput) {
        emailInput.focus();
        emailInput.onkeydown = (ev) => { if (ev.key === 'Enter') send(); };
      }
      const cancel = el.querySelector('[data-cancel]');
      if (cancel) cancel.onclick = closeModal;
      const verify = () => run(async () => {
        const code = el.querySelector('[data-code]').value.replace(/\D/g, '');
        if (code.length < 6) throw new Error('Der Code hat 6 Ziffern.');
        const s = await Cloud.verifyCode(step.email, code);
        // Ab hier übernimmt signedIn() (Name, Haushalt …) – der Anmelde-Dialog ist fertig.
        step.done = true;
        closeModal();
        signedIn(s.user);
      });
      const v = el.querySelector('[data-verify]');
      if (v) v.onclick = verify;
      const codeInput = el.querySelector('[data-code]');
      if (codeInput) {
        codeInput.focus();
        codeInput.oninput = () => { if (codeInput.value.replace(/\D/g, '').length === 6) verify(); };
      }
      const back = el.querySelector('[data-back]');
      if (back) back.onclick = () => { step.sent = false; step.error = ''; draw(); };
      const resend = el.querySelector('[data-resend]');
      if (resend) resend.onclick = () => run(async () => { await Cloud.sendCode(step.email); toast('Neuer Code ist unterwegs 📬'); });
    });
    draw();
  }

  const GOOGLE_ICON = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

  let signingIn = false;

  /**
   * Nach dem Anmelden: Name sicherstellen, dann je nach Lage den bisherigen Putzplan ins
   * Konto übernehmen, zu einem vorhandenen Haushalt wechseln oder die Einrichtung fortsetzen.
   */
  async function signedIn(user) {
    if (signingIn) return;
    signingIn = true;
    let context = 'settings';
    try { context = sessionStorage.getItem(LOGIN_CONTEXT_KEY) || 'settings'; sessionStorage.removeItem(LOGIN_CONTEXT_KEY); } catch (e) { /* egal */ }
    try {
      cloud.user = user;
      await ensureName();
      await refreshHouseholds();
      if (activeId === 'local') {
        const hasLocal = state.onboarded && (state.tasks.length || state.rooms.length);
        if (context === 'join' && !hasLocal) {
          render();
          joinDialog();
        } else if (context === 'onboarding-finish') {
          await finishOnboarding();
        } else if (hasLocal) {
          await moveLocalToCloud();
          if (context === 'join') joinDialog();
        } else if (cloud.households.length) {
          await switchHousehold(cloud.households[0].id);
          toast(`Willkommen zurück, ${userName()}! 👋`);
        } else {
          render(); // Einrichtung fortsetzen – am Ende wird der Haushalt angelegt.
        }
      } else {
        subscribeActive();
        scheduleSync(0);
        render();
      }
    } catch (e) {
      toast(Cloud.friendly(e));
    } finally {
      signingIn = false;
    }
  }

  /** Beim ersten Anmelden nach dem Namen fragen (Google liefert ihn meist mit). */
  function ensureName() {
    const md = (cloud.user && cloud.user.user_metadata) || {};
    if (md.name) return Promise.resolve();
    const suggestion = md.full_name || md.given_name || '';
    return new Promise((resolve) => {
      openModal(`
        <h2>👋 Wie heißt du?</h2>
        <p class="muted">So sehen dich die anderen in deinem Haushalt.</p>
        <div class="form">
          <input class="input" data-name maxlength="40" value="${esc(suggestion)}" placeholder="Vorname">
          <button class="btn primary block" data-ok>Weiter</button>
        </div>`, (el) => {
        const input = el.querySelector('[data-name]');
        input.focus();
        el.querySelector('[data-ok]').onclick = async () => {
          const name = input.value.trim();
          if (!name) return;
          closeModal();
          try {
            await Cloud.updateName(name);
            cloud.user.user_metadata = Object.assign({}, cloud.user.user_metadata, { name });
          } catch (e) { /* Name wird beim nächsten Mal gefragt */ }
          resolve();
        };
      });
      // Schließen über den Hintergrund: ohne Namen weiter.
      const backdrop = document.querySelector('#modal-root [data-close]');
      if (backdrop) backdrop.onclick = () => { closeModal(); resolve(); };
    });
  }

  /** Auswahl „Wer bist du?“ unter den Mitgliedern ohne Konto. Löst mit einer Mitglieds-ID auf (null = neu). */
  function whoAreYou(intro) {
    const free = state.members.filter((m) => !m.userId);
    if (!free.length) return Promise.resolve(null);
    return new Promise((resolve) => {
      openModal(`
        <h2>🙋 Wer bist du?</h2>
        <p class="muted">${intro || 'Wähle deinen Namen – deine Punkte und Aufgaben bleiben dann erhalten.'}</p>
        <div class="menu">
          ${free.map((m) => `<button data-m="${m.id}">${avatar(m)} ${esc(m.name)}</button>`).join('')}
          <button data-m="">＋ Ich bin neu (${esc(userName())})</button>
        </div>`, (el) => {
        el.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { closeModal(); resolve(b.dataset.m || null); }; });
      });
      const backdrop = document.querySelector('#modal-root [data-close]');
      if (backdrop) backdrop.onclick = () => { closeModal(); resolve(null); };
    });
  }

  /** Verknüpft mich mit einem Mitglied (oder legt ein neues an) und gibt dessen ID zurück. */
  function linkMe(memberId) {
    let m = memberId && member(memberId);
    if (!m) {
      m = { id: uid(), name: userName() || 'Ich', color: T.MEMBER_COLORS[state.members.length % T.MEMBER_COLORS.length], offDays: [] };
      state.members.push(m);
    }
    m.userId = cloud.user.id;
    return m.id;
  }

  /** Den bisherigen Putzplan (ohne Konto) als ersten Haushalt ins Konto übernehmen. */
  async function moveLocalToCloud(meId) {
    const chosen = meId !== undefined ? meId : await whoAreYou('Damit deine Punkte erhalten bleiben: Welcher Name bist du?');
    const myId = linkMe(chosen);
    const name = 'Zuhause';
    const h = await Cloud.createHousehold(name, '🏠', myId, userName());
    // Sicherheitskopie des bisherigen Stands behalten.
    lsSet('putzplan.v1.vor-konto', JSON.stringify(state));
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* egal */ }
    activeId = h;
    lsSet(ACTIVE_KEY, h);
    persist();
    await refreshHouseholds();
    subscribeActive();
    render();
    await syncNow();
    refreshMembers();
    toast('Dein Putzplan ist jetzt in deinem Konto gesichert ☁️');
  }

  // ------------------------------------------------ Haushalte verwalten

  function householdChip() {
    if (!cloud.user || !isCloudHousehold()) return '';
    const h = activeHousehold();
    const status = { syncing: '⏳', offline: '⚠️' }[cloud.status] || '';
    return `<button class="household-chip" data-action="household-menu">${h ? `${h.icon} ${esc(h.name)}` : '🏠 Haushalt'} ▾
      ${status ? `<span title="${cloud.status === 'offline' ? 'Offline – wird später abgeglichen' : 'Wird abgeglichen'}">${status}</span>` : ''}</button>`;
  }

  function householdMenu() {
    openModal(`
      <h2>Haushalt wechseln</h2>
      <div class="menu">
        ${cloud.households.map((h) => `<button data-h="${h.id}" class="${h.id === activeId ? 'on' : ''}">${h.icon} ${esc(h.name)}${h.id === activeId ? ' ✓' : ''}</button>`).join('')}
        <button data-new>＋ Neuer Haushalt (z. B. Ferienhaus)</button>
        <button data-join>🔑 Mit Code beitreten</button>
        <button data-cancel class="muted">Abbrechen</button>
      </div>`, (el) => {
      el.querySelectorAll('[data-h]').forEach((b) => { b.onclick = () => { closeModal(); switchHousehold(b.dataset.h); }; });
      el.querySelector('[data-new]').onclick = () => { closeModal(); newHouseholdDialog(); };
      el.querySelector('[data-join]').onclick = () => { closeModal(); joinDialog(); };
      el.querySelector('[data-cancel]').onclick = closeModal;
    });
  }

  function householdForm(title, h, onSubmit) {
    let icon = (h && h.icon) || '🏠';
    openModal(`
      <h2>${title}</h2>
      <form class="form">
        <label>Name<input class="input" name="name" required maxlength="40" value="${esc((h && h.name) || '')}" placeholder="z. B. Wohnung, Ferienhaus"></label>
        <div class="icon-grid">${HOUSEHOLD_ICONS.map((i) => `<button type="button" class="icon-pick ${i === icon ? 'on' : ''}" data-icon="${i}">${i}</button>`).join('')}</div>
        <div class="btn-row"><button type="button" class="btn" data-cancel>Abbrechen</button><button type="submit" class="btn primary">Speichern</button></div>
      </form>`, (el) => {
      el.querySelectorAll('[data-icon]').forEach((b) => {
        b.onclick = () => { icon = b.dataset.icon; el.querySelectorAll('[data-icon]').forEach((x) => x.classList.toggle('on', x === b)); };
      });
      el.querySelector('[data-cancel]').onclick = closeModal;
      el.querySelector('form').onsubmit = (ev) => {
        ev.preventDefault();
        const name = ev.target.name.value.trim();
        if (!name) return;
        closeModal();
        cloudTask(() => onSubmit(name, icon));
      };
    });
  }

  function newHouseholdDialog() {
    householdForm('Neuer Haushalt', null, async (name, icon) => {
      const me = { id: uid(), name: userName() || 'Ich', color: T.MEMBER_COLORS[0], offDays: [], userId: cloud.user.id };
      const h = await Cloud.createHousehold(name, icon, me.id, userName());
      await refreshHouseholds();
      persist();
      activeId = h;
      lsSet(ACTIVE_KEY, h);
      state = defaultState();
      state.members = [me];
      cloud.members = [];
      ui = { tab: 'today', roomId: null, showMore: false, onboardStep: 1, newHousehold: true, onboardMembers: [me.name] };
      subscribeActive();
      render();
    });
  }

  function joinDialog() {
    openModal(`
      <h2>🔑 Haushalt beitreten</h2>
      <p class="muted">Gib den 6-stelligen Code ein, den du bekommen hast. Deine bisherigen Haushalte bleiben erhalten.</p>
      <div class="form">
        <input class="input code-input" inputmode="numeric" maxlength="6" placeholder="123456" data-code>
        <button class="btn primary block" data-join>Beitreten</button>
        <button class="btn block" data-cancel>Abbrechen</button>
      </div>`, (el) => {
      const input = el.querySelector('[data-code]');
      input.focus();
      el.querySelector('[data-cancel]').onclick = closeModal;
      el.querySelector('[data-join]').onclick = () => {
        const code = input.value.replace(/\D/g, '');
        if (code.length !== 6) { toast('Der Code hat 6 Ziffern.'); return; }
        closeModal();
        cloudTask(async () => {
          const h = await Cloud.join(code, userName());
          await refreshHouseholds();
          await switchHousehold(h);
          const chosen = await whoAreYou();
          const myId = linkMe(chosen);
          await Cloud.setMyMember(h, cloud.user.id, myId, userName());
          await refreshHouseholds();
          save();
          render();
          const hh = activeHousehold();
          toast(`Willkommen in „${hh ? hh.name : 'deinem neuen Haushalt'}“ 🎉`);
        });
      };
    });
  }

  async function inviteDialog() {
    let code;
    try { code = await Cloud.invite(activeId); } catch (e) { toast(Cloud.friendly(e)); return; }
    const h = activeHousehold();
    const text = `Komm in meinen Haushalt „${h ? h.name : 'Zuhause'}“ in Putzplan: Öffne die App → Mehr → Haushalt → „Mit Code beitreten“ und gib diesen Code ein: ${code} (7 Tage gültig)`;
    openModal(`
      <h2>✉️ Einladen</h2>
      <p class="muted">Schick diesen Code an die Person, die mitmachen soll. Er ist 7 Tage gültig.</p>
      <div class="invite-code">${code.slice(0, 3)} ${code.slice(3)}</div>
      <p class="small muted">In der App: Mehr → Haushalt → „Mit Code beitreten“.</p>
      <div class="btn-row"><button class="btn" data-cancel>Schließen</button><button class="btn primary" data-share>Teilen</button></div>`, (el) => {
      el.querySelector('[data-cancel]').onclick = closeModal;
      el.querySelector('[data-share]').onclick = async () => {
        try {
          if (Native.isNative && Native.shareText) await Native.shareText(text);
          else if (navigator.share) await navigator.share({ text });
          else { await navigator.clipboard.writeText(text); toast('Einladung kopiert 📋'); }
        } catch (e) { /* abgebrochen */ }
      };
    });
  }

  function myRole() {
    const h = activeHousehold();
    return h ? h.role : null;
  }

  async function leaveHousehold() {
    const h = activeHousehold();
    if (!h || !confirm(`„${h.name}“ wirklich verlassen? Die Daten bleiben für die anderen erhalten.`)) return;
    cloudTask(async () => {
      await Cloud.leave(h.id);
      await afterHouseholdGone(h.id);
      await refreshHouseholds();
      toast(`„${h.name}“ verlassen`);
    });
  }

  async function deleteHousehold() {
    const h = activeHousehold();
    if (!h || !confirm(`„${h.name}“ mit allen Räumen, Aufgaben, Pflanzen und dem Verlauf für alle Mitglieder löschen?`)) return;
    if (!confirm('Wirklich? Das lässt sich nicht rückgängig machen.')) return;
    cloudTask(async () => {
      await Cloud.deleteHousehold(h.id);
      await afterHouseholdGone(h.id);
      await refreshHouseholds();
      toast(`„${h.name}“ gelöscht`);
    });
  }

  async function removeAccountMember(userId) {
    const m = cloud.members.find((x) => x.user_id === userId);
    if (!m || !confirm(`${m.display_name || 'Diese Person'} aus dem Haushalt entfernen?`)) return;
    cloudTask(async () => {
      await Cloud.removeMember(activeId, userId);
      const linked = state.members.find((x) => x.userId === userId);
      if (linked) { delete linked.userId; save(); }
      await refreshMembers();
    });
  }

  /** Alle Haushalts-Daten vom Gerät entfernen und zum Anfang zurück (Abmelden, Konto gelöscht). */
  function clearCloudData() {
    for (const h of cloud.households.slice()) forgetHousehold(h.id);
    if (activeId !== 'local') forgetHousehold(activeId);
    if (cloud.unsubscribe) { cloud.unsubscribe(); cloud.unsubscribe = null; }
    cloud.user = null;
    cloud.households = [];
    cloud.members = [];
    lsSet(HOUSEHOLDS_KEY, '[]');
    activeId = 'local';
    lsSet(ACTIVE_KEY, 'local');
    state = load('local');
    migrate();
    ui = { tab: 'today', roomId: null, showMore: false };
    render();
  }

  async function signOutAccount() {
    if (!confirm('Abmelden? Deine Haushalte werden von diesem Handy entfernt – in deinem Konto bleiben sie erhalten.')) return;
    await syncNow();
    await Cloud.signOut();
    clearCloudData();
    toast('Abgemeldet');
  }

  async function deleteAccount() {
    if (!confirm('Konto löschen? Du verlässt alle Haushalte. Haushalte, in denen sonst niemand ist, werden mit allen Daten gelöscht.')) return;
    if (!confirm('Wirklich endgültig löschen? Das lässt sich nicht rückgängig machen.')) return;
    cloudTask(async () => {
      await Cloud.deleteAccount();
      await Cloud.signOut();
      clearCloudData();
      toast('Dein Konto wurde gelöscht.');
    });
  }

  function renameMe() {
    const name = prompt('Dein Name', userName());
    if (!name || !name.trim()) return;
    cloudTask(async () => {
      await Cloud.updateName(name.trim());
      cloud.user.user_metadata = Object.assign({}, cloud.user.user_metadata, { name: name.trim() });
      const myId = myMemberId();
      if (myId && member(myId)) member(myId).name = name.trim();
      for (const h of cloud.households) {
        await Cloud.setMyMember(h.id, cloud.user.id, h.id === activeId ? myId : h.memberId, name.trim()).catch(() => {});
      }
      save();
      render();
    });
  }

  function syncStatusText() {
    if (cloud.status === 'offline') return '⚠️ Offline – wird abgeglichen, sobald du wieder Netz hast';
    if (cloud.status === 'syncing') return '⏳ Wird abgeglichen …';
    if (cloud.lastSync) return `✓ Abgeglichen um ${new Date(cloud.lastSync).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
    return '';
  }

  function accountCard() {
    if (!cloud.user) {
      return `<section class="card">
        <h2>☁️ Konto</h2>
        <p class="muted small">Mit einem Konto ist dein Putzplan gesichert und du kannst ihn mit deinem Haushalt teilen –
          jede Person auf ihrem eigenen Handy.</p>
        <button class="btn primary block" data-action="login">Anmelden oder Konto anlegen</button>
      </section>`;
    }
    return `<section class="card">
        <h2>☁️ Konto</h2>
        <div class="row account-row"><div class="row-main"><div class="row-title">${esc(userName())}</div>
          <div class="row-sub">${esc(cloud.user.email || '')}</div></div>
          <button class="icon-btn" data-action="rename-me" title="Name ändern">✎</button></div>
        <p class="small muted">${syncStatusText()}</p>
        <div class="btn-row"><button class="btn" data-action="logout">Abmelden</button>
          <button class="btn danger" data-action="delete-account">Konto löschen</button></div>
      </section>`;
  }

  function householdCard() {
    if (!cloud.user || !isCloudHousehold()) return '';
    const h = activeHousehold();
    const owner = myRole() === 'owner';
    return `<section class="card">
        <h2>${h ? `${h.icon} ${esc(h.name)}` : '🏠 Haushalt'}</h2>
        <p class="muted small">Alle hier sehen dieselben Räume, Aufgaben, Pflanzen und Punkte.</p>
        <ul class="list">${cloud.members.map((m) => {
          const linked = state.members.find((x) => x.userId === m.user_id);
          return `<li class="row">${linked ? avatar(linked) : '<span class="avatar">?</span>'}
            <div class="row-main"><div class="row-title">${esc((linked && linked.name) || m.display_name || 'Mitglied')}
              ${m.user_id === cloud.user.id ? '<span class="badge">Du</span>' : ''}${m.role === 'owner' ? ' <span class="badge">Verwaltet</span>' : ''}</div></div>
            ${owner && m.user_id !== cloud.user.id ? `<button class="icon-btn" data-action="remove-account" data-id="${m.user_id}" title="Entfernen">✕</button>` : ''}</li>`;
        }).join('')}</ul>
        <button class="btn primary block" data-action="invite">✉️ Jemanden einladen</button>
        <div class="btn-row">
          <button class="btn" data-action="household-menu">Wechseln / Neu</button>
          <button class="btn" data-action="household-edit">Umbenennen</button>
        </div>
        <div class="btn-row">
          <button class="btn" data-action="household-leave">Verlassen</button>
          ${owner ? '<button class="btn danger" data-action="household-delete">Löschen</button>' : ''}
        </div>
      </section>`;
  }

  /** Einmaliger Hinweis für alle, die die App schon ohne Konto nutzen. */
  function accountHint() {
    if (cloud.user || isCloudHousehold() || state.settings.accountHintDismissed || !Cloud || !Cloud.available()) return '';
    return `<div class="hint"><span>☁️</span><div class="grow"><strong>Neu: Konto & gemeinsamer Haushalt</strong><br>
      <span class="muted small">Putzplan sichern und mit deinem Haushalt teilen – jede Person auf dem eigenen Handy.</span></div>
      <button class="btn primary" data-action="login">Los</button>
      <button class="icon-btn" data-action="dismiss-account-hint" title="Ausblenden">✕</button></div>`;
  }

  // ---------------------------------------------------------------- Einkaufsliste
  //
  // Wie bei Bring!: Artikel als Kacheln, nach Supermarkt-Kategorien sortiert. Ein Tipp auf eine
  // Kachel hakt sie ab, „Zuletzt gekauft“ holt sie mit einem Tipp zurück. Listen und Artikel
  // gehören zum Haushalt und werden mit allen Mitgliedern abgeglichen.

  const Sh = window.Shopping;
  const DEFAULT_LIST_ID = 'einkauf'; // feste ID – zwei Handys legen sonst je eine eigene Liste an
  const KEEP_DONE = 40; // so viele gekaufte Artikel bleiben pro Liste für „Zuletzt gekauft“
  const LIST_ICONS = ['🛒', '🧴', '🔨', '🎁', '🌱', '🐾', '💊', '🏖️'];

  function shopLists() {
    if (!Array.isArray(state.shoppingLists)) state.shoppingLists = [];
    if (!Array.isArray(state.shoppingItems)) state.shoppingItems = [];
    if (!state.shoppingLists.length) state.shoppingLists.push({ id: DEFAULT_LIST_ID, name: 'Einkauf', icon: '🛒' });
    return state.shoppingLists;
  }

  function currentList() {
    const lists = shopLists();
    return lists.find((l) => l.id === ui.shopListId) || lists[0];
  }

  const shopItem = (id) => byId(state.shoppingItems || [], id);
  const openItems = (listId) => (state.shoppingItems || []).filter((i) => i.listId === listId && !i.done);
  const openCount = () => (state.shoppingItems || []).filter((i) => !i.done && (state.shoppingLists || []).some((l) => l.id === i.listId)).length;

  /** Kategorie für einen eingetippten Namen: gemerkt, aus dem Katalog oder „Sonstiges“. */
  function guessCategory(name) {
    const remembered = (state.settings.shopCats || {})[Sh.norm(name)];
    if (remembered) return remembered;
    const hit = Sh.findByName(name) || Sh.norm(name).split(/[\s,/-]+/).filter((w) => w.length >= 3).map(Sh.findByName).find(Boolean);
    return hit ? hit.cat : 'other';
  }

  /**
   * Artikel auf eine Liste setzen. Steht er schon drauf, wird er nur „angefasst“ – so gewinnt
   * „hinzufügen“ gegen ein gleichzeitiges Abhaken auf einem anderen Handy.
   */
  function addShopItem(entry, listId, opts) {
    const o = opts || {};
    const list = listId || currentList().id;
    const name = entry.name.trim();
    if (!name) return null;
    const key = entry.key || (Sh.findByName(name) || {}).key || null;
    let it = state.shoppingItems.find((x) => x.listId === list && (key ? x.key === key : Sh.norm(x.name) === Sh.norm(name)));
    const now = Date.now();
    let msg;
    if (it && !it.done) {
      it.addedAt = now;
      if (entry.spec) it.spec = entry.spec;
      msg = `${it.name} steht schon auf der Liste`;
    } else if (it) {
      Object.assign(it, { done: false, doneAt: null, addedAt: now, addedBy: myMemberId() || null, spec: entry.spec || '' });
      msg = `${it.icon} ${it.name} hinzugefügt`;
    } else {
      const cat = entry.cat || guessCategory(name);
      it = { id: uid(), listId: list, name, key, cat, icon: entry.icon || Sh.iconFor(name, cat), spec: entry.spec || '', done: false, addedAt: now, addedBy: myMemberId() || null };
      state.shoppingItems.push(it);
      msg = `${it.icon} ${it.name} hinzugefügt`;
    }
    if (!o.quiet) toast(msg);
    return it;
  }

  /** Gekaufte Artikel aufräumen: pro Liste nur die letzten behalten. */
  function pruneShopItems(listId) {
    const done = state.shoppingItems.filter((i) => i.listId === listId && i.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    if (done.length <= KEEP_DONE) return;
    const drop = new Set(done.slice(KEEP_DONE).map((i) => i.id));
    state.shoppingItems = state.shoppingItems.filter((i) => !drop.has(i.id));
  }

  function shopDone(id) {
    const it = shopItem(id);
    if (!it) return;
    it.done = true;
    it.doneAt = Date.now();
    pruneShopItems(it.listId);
    save();
    render();
    toast(`${it.icon} ${it.name} gekauft`, { label: 'Rückgängig', run: () => { it.done = false; it.doneAt = null; save(); render(); } });
  }

  function shopTile(it, mode) {
    const m = it.addedBy && member(it.addedBy);
    const action = mode === 'open' ? 'shop-done' : 'shop-add-item';
    return `<div class="tile ${mode}" role="button" tabindex="0" data-action="${action}" data-id="${it.id}">
      <span class="tile-icon">${it.icon}</span>
      <span class="tile-name">${esc(it.name)}</span>
      ${it.spec ? `<span class="tile-spec">${esc(it.spec)}</span>` : ''}
      ${mode === 'open' && m && state.members.length > 1 ? `<span class="tile-who" style="background:${m.color}" title="Hinzugefügt von ${esc(m.name)}">${esc(m.name.charAt(0).toUpperCase())}</span>` : ''}
      ${mode === 'open' ? `<button class="tile-edit" data-action="shop-edit" data-id="${it.id}" title="Bearbeiten">✎</button>` : ''}
    </div>`;
  }

  function catalogTile(c, list) {
    const on = (state.shoppingItems || []).some((i) => i.listId === list.id && !i.done && i.key === c.key);
    return `<div class="tile catalog ${on ? 'on' : ''}" role="button" tabindex="0" data-action="shop-add-key" data-key="${c.key}">
      <span class="tile-icon">${c.icon}</span><span class="tile-name">${esc(c.name)}</span></div>`;
  }

  /** Vorschläge beim Tippen: Katalog-Treffer plus „…“ als eigener Artikel. */
  function shopSuggestions(q) {
    const query = (q || '').trim();
    if (!query) return '';
    const list = currentList();
    const hits = Sh.search(query, 9);
    const exact = hits.some((h) => Sh.norm(h.name) === Sh.norm(query));
    return `<div class="tile-grid">
      ${exact ? '' : `<div class="tile catalog free" role="button" tabindex="0" data-action="shop-add-free">
        <span class="tile-icon">${Sh.iconFor(query, guessCategory(query))}</span><span class="tile-name">${esc(query)}</span><span class="tile-spec">eigener Artikel</span></div>`}
      ${hits.map((c) => catalogTile(c, list)).join('')}
    </div>`;
  }

  function viewShopping() {
    const list = currentList();
    const lists = shopLists();
    const open = openItems(list.id);
    const recent = state.shoppingItems.filter((i) => i.listId === list.id && i.done)
      .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 18);
    const byCat = Sh.CATEGORIES.map((c) => ({ c, items: open.filter((i) => (i.cat || 'other') === c.key).sort((a, b) => a.name.localeCompare(b.name, 'de')) }))
      .filter((g) => g.items.length);
    const openCats = ui.shopOpenCats || (ui.shopOpenCats = new Set());

    return `
      <header class="page-head"><h1>Einkauf</h1>
        <p class="muted">${open.length ? `${open.length} Artikel auf „${esc(list.name)}“` : `„${esc(list.name)}“ ist leer`}</p></header>
      <div class="list-chips">
        ${lists.map((l) => {
          const n = openItems(l.id).length;
          return `<button class="chip ${l.id === list.id ? 'on' : ''}" data-action="shop-list" data-id="${l.id}">${l.icon} ${esc(l.name)}${n ? ` · ${n}` : ''}</button>`;
        }).join('')}
        <button class="chip" data-action="shop-list-new" title="Neue Liste">＋</button>
        <button class="chip" data-action="shop-list-edit" title="Liste bearbeiten">✎</button>
      </div>
      <div class="shop-add"><input class="input" type="search" data-shop-q placeholder="🔍 Was brauchst du?" value="${esc(ui.shopQuery || '')}" enterkeyhint="done"></div>
      <div data-shop-suggest>${shopSuggestions(ui.shopQuery)}</div>
      ${byCat.length ? byCat.map((g) => `<section class="shop-cat"><h3>${g.c.icon} ${g.c.name}</h3>
          <div class="tile-grid">${g.items.map((i) => shopTile(i, 'open')).join('')}</div></section>`).join('')
        : '<div class="empty"><div class="emoji">🛒</div><p>Alles da! Tippe oben, was du brauchst, oder wähle unten aus dem Katalog.</p></div>'}
      ${recent.length ? `<section class="shop-cat"><h3>🕑 Zuletzt gekauft</h3>
        <div class="tile-grid">${recent.map((i) => shopTile(i, 'recent')).join('')}</div></section>` : ''}
      <section class="shop-catalog"><h3>📚 Katalog</h3>
        ${Sh.CATEGORIES.map((c) => `<details ${openCats.has(c.key) ? 'open' : ''} data-shop-cat="${c.key}"><summary>${c.icon} ${c.name}</summary>
          ${openCats.has(c.key) ? `<div class="tile-grid">${Sh.CATALOG.filter((i) => i.cat === c.key).map((i) => catalogTile(i, list)).join('')}</div>` : ''}</details>`).join('')}
      </section>`;
  }

  function addFromQuery() {
    const q = (ui.shopQuery || '').trim();
    if (!q) return;
    const hit = Sh.findByName(q);
    addShopItem(hit ? { name: hit.name, key: hit.key, cat: hit.cat, icon: hit.icon } : { name: q }, currentList().id);
    ui.shopQuery = '';
    save();
    render();
    const input = document.querySelector('[data-shop-q]');
    if (input) input.focus();
  }

  function shopItemDialog(id) {
    const it = shopItem(id);
    if (!it) return;
    const lists = shopLists();
    openModal(`
      <h2>${it.icon} ${esc(it.name)}</h2>
      <form class="form">
        ${it.key ? '' : `<label>Name<input class="input" name="name" value="${esc(it.name)}" maxlength="60"></label>`}
        <label>Angabe<input class="input" name="spec" value="${esc(it.spec || '')}" maxlength="60" placeholder="z. B. 2 Liter, bio, die rote Packung"></label>
        <label>Kategorie<select class="input" name="cat">${Sh.CATEGORIES.map((c) => `<option value="${c.key}" ${c.key === (it.cat || 'other') ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}</select></label>
        ${lists.length > 1 ? `<label>Liste<select class="input" name="listId">${lists.map((l) => `<option value="${l.id}" ${l.id === it.listId ? 'selected' : ''}>${l.icon} ${esc(l.name)}</option>`).join('')}</select></label>` : ''}
        ${it.addedBy && member(it.addedBy) ? `<p class="small muted">Hinzugefügt von ${esc(member(it.addedBy).name)}</p>` : ''}
        <div class="btn-row">
          <button type="button" class="btn danger" data-del>Entfernen</button>
          <button type="button" class="btn" data-cancel>Abbrechen</button>
          <button type="submit" class="btn primary">Speichern</button>
        </div>
      </form>`, (el) => {
      el.querySelector('[data-cancel]').onclick = closeModal;
      el.querySelector('[data-del]').onclick = () => {
        state.shoppingItems = state.shoppingItems.filter((x) => x.id !== id);
        save(); closeModal(); render();
      };
      el.querySelector('form').onsubmit = (ev) => {
        ev.preventDefault();
        const f = ev.target;
        if (f.name && f.name.value.trim()) it.name = f.name.value.trim();
        it.spec = f.spec.value.trim();
        if (f.cat.value !== it.cat) {
          it.cat = f.cat.value;
          // Eigene Artikel: Kategorie merken, damit sie beim nächsten Mal gleich stimmt.
          if (!it.key) state.settings.shopCats = Object.assign({}, state.settings.shopCats, { [Sh.norm(it.name)]: it.cat });
        }
        if (f.listId) it.listId = f.listId.value;
        save(); closeModal(); render();
      };
    });
  }

  function shopListDialog(listId) {
    const l = listId ? shopLists().find((x) => x.id === listId) : null;
    let icon = (l && l.icon) || '🛒';
    openModal(`
      <h2>${l ? 'Liste bearbeiten' : 'Neue Liste'}</h2>
      <form class="form">
        <label>Name<input class="input" name="name" required maxlength="40" value="${esc((l && l.name) || '')}" placeholder="z. B. Drogerie, Baumarkt"></label>
        <div class="icon-grid">${LIST_ICONS.map((i) => `<button type="button" class="icon-pick ${i === icon ? 'on' : ''}" data-icon="${i}">${i}</button>`).join('')}</div>
        <div class="btn-row">
          ${l && shopLists().length > 1 ? '<button type="button" class="btn danger" data-del>Löschen</button>' : ''}
          <button type="button" class="btn" data-cancel>Abbrechen</button>
          <button type="submit" class="btn primary">Speichern</button>
        </div>
      </form>`, (el) => {
      el.querySelectorAll('[data-icon]').forEach((b) => {
        b.onclick = () => { icon = b.dataset.icon; el.querySelectorAll('[data-icon]').forEach((x) => x.classList.toggle('on', x === b)); };
      });
      el.querySelector('[data-cancel]').onclick = closeModal;
      const del = el.querySelector('[data-del]');
      if (del) del.onclick = () => {
        if (!confirm(`Liste „${l.name}“ mit allen Artikeln löschen?`)) return;
        state.shoppingLists = state.shoppingLists.filter((x) => x.id !== l.id);
        state.shoppingItems = state.shoppingItems.filter((x) => x.listId !== l.id);
        ui.shopListId = null;
        save(); closeModal(); render();
      };
      el.querySelector('form').onsubmit = (ev) => {
        ev.preventDefault();
        const name = ev.target.name.value.trim();
        if (!name) return;
        if (l) Object.assign(l, { name, icon });
        else {
          const nl = { id: uid(), name, icon };
          shopLists().push(nl);
          ui.shopListId = nl.id;
        }
        save(); closeModal(); render();
      };
    });
  }

  /**
   * „🛒 Auf die Einkaufsliste“ aus einer Aufgabe, einer Pflanze oder dem Timer:
   * passende Artikel antippen oder etwas anderes eintippen.
   */
  function shopQuickDialog(title, suggestions) {
    const lists = shopLists();
    let listId = (lists.find((l) => l.id === ui.shopListId) || lists[0]).id;
    const draw = () => openModal(`
      <h2>🛒 ${esc(title)}</h2>
      ${lists.length > 1 ? `<div class="list-chips">${lists.map((l) => `<button class="chip ${l.id === listId ? 'on' : ''}" data-list="${l.id}">${l.icon} ${esc(l.name)}</button>`).join('')}</div>` : ''}
      ${suggestions.length ? `<p class="small muted">Antippen, was fehlt:</p>
        <div class="tile-grid">${suggestions.map((c) => catalogTile(c, { id: listId })).join('')}</div>` : ''}
      <div class="inline-form quick-other"><input class="input" data-other placeholder="Etwas anderes …" maxlength="60"><button class="btn" data-add>＋</button></div>
      <button class="btn primary block" data-close-quick>Fertig</button>`, (el) => {
      el.querySelectorAll('[data-list]').forEach((b) => { b.onclick = () => { listId = b.dataset.list; draw(); }; });
      el.querySelectorAll('[data-action="shop-add-key"]').forEach((t) => {
        t.removeAttribute('data-action');
        t.onclick = () => {
          const c = Sh.item(t.dataset.key);
          addShopItem({ name: c.name, key: c.key, cat: c.cat, icon: c.icon }, listId);
          save();
          draw();
        };
      });
      const other = el.querySelector('[data-other]');
      const addOther = () => {
        if (!other.value.trim()) return;
        addShopItem({ name: other.value }, listId);
        save();
        draw();
      };
      el.querySelector('[data-add]').onclick = addOther;
      other.onkeydown = (ev) => { if (ev.key === 'Enter') addOther(); };
      el.querySelector('[data-close-quick]').onclick = () => { closeModal(); render(); };
    });
    draw();
  }

  // ---------------------------------------------------------------- Pflanzen
  //
  // Jede Pflanze bekommt Pflegeaufgaben (Gießen, Düngen, Umtopfen) als normale Aufgaben
  // mit festem Fälligkeitstag. Den Tag berechnet das Pflanzen-Modul aus Art, Topf, Licht,
  // Jahreszeit, Wetter und der gelernten Rückmeldung. So erscheinen Pflanzen unter „Heute“,
  // im Putz-Timer und in der Rangliste – oder, wenn man das ausschaltet, als eigener Block.

  const plant = (id) => byId(state.plants || [], id);
  // Diese Werte ändert das Abhaken – für „Rückgängig“ werden sie gesichert.
  const PLANT_STATE_KEYS = ['lastWatered', 'lastFed', 'repottedOn', 'refills', 'learn', 'waterNotBefore'];
  const WEATHER_EVERY_MS = 3 * 3600 * 1000;
  const CARE_ICONS = { water: '💧', feed: '🌱', repot: '🪴' };
  let weatherBusy = false;

  function plantsSettings() {
    if (!state.settings.plants) state.settings.plants = { inPlan: true, location: null, weather: null };
    return state.settings.plants;
  }

  /** Aktuelles Wetter am eingestellten Ort – nur wenn es nicht zu alt ist. */
  function plantWeather() {
    const w = plantsSettings().weather;
    return w && Date.now() - w.at < 12 * 3600 * 1000 ? w : null;
  }

  /** Pauschale Gieß-Aufgaben aus den Vorlagen („Pflanzen gießen“, „Zimmerpflanzen gießen“). */
  function isGenericWatering(t) {
    return !t.plantId && /pflanz/i.test(t.name) && /gie(ß|ss)en/i.test(t.name);
  }

  /** Aufgaben der Pflanzen anlegen bzw. aktualisieren (Fälligkeit, Name, Hinweis). */
  function syncPlants() {
    if (!Array.isArray(state.plants)) state.plants = [];
    const day = S.today();
    const weather = plantWeather();
    const live = new Set();
    for (const p of state.plants) {
      for (const c of P.careTasks(p, day, weather)) {
        let t = state.tasks.find((x) => x.plantId === p.id && x.plantCare === c.care);
        if (!t) {
          // Feste ID je Pflanze und Pflege – so entstehen auf zwei Geräten keine doppelten Aufgaben.
          t = { id: `${p.id}-${c.care}`, plantId: p.id, plantCare: c.care, minutes: c.minutes, lastDone: null, assignee: null, paused: false, snoozedUntil: null };
          state.tasks.push(t);
        }
        Object.assign(t, { roomId: p.roomId, name: c.name, note: c.note, dueOn: c.dueOn, interval: c.interval });
        live.add(t.id);
      }
    }
    state.tasks = state.tasks.filter((t) => !t.plantId || live.has(t.id));
    // Solange es eigene Pflanzen gibt, ruhen die pauschalen Gieß-Aufgaben.
    const has = state.plants.length > 0;
    for (const t of state.tasks) {
      if (!isGenericWatering(t)) continue;
      if (has && !t.paused) { t.paused = true; t.pausedByPlants = true; }
      if (!has && t.pausedByPlants) { t.paused = false; delete t.pausedByPlants; }
    }
  }

  /** Nach dem Abhaken einer Pflegeaufgabe: Pflanze aktualisieren (Zustand vorher für „Rückgängig“ merken). */
  function plantCareDone(t, entry) {
    const p = plant(t.plantId);
    if (!p) return;
    entry.plantPrev = { id: p.id };
    for (const k of PLANT_STATE_KEYS) entry.plantPrev[k] = p[k] === undefined ? null : p[k];
    const day = entry.day;
    if (t.plantCare === 'water') {
      if (P.waterMode(p, day) === 'reservoir') p.refills = (p.refills || 0) + 1;
      p.lastWatered = day;
      p.waterNotBefore = null;
    }
    if (t.plantCare === 'feed') p.lastFed = day;
    if (t.plantCare === 'repot') {
      p.repottedOn = day;
      // Frische Erde hat genug Nährstoffe – erst nach etwa 6 Wochen wieder düngen.
      const feed = P.careTasks(p, day, null).find((c) => c.care === 'feed');
      if (feed) p.lastFed = Math.max(typeof p.lastFed === 'number' ? p.lastFed : -Infinity, day + 42 - feed.interval);
    }
    syncPlants();
  }

  /** Nächster Termin einer Pflegeaufgabe (null = ruht). */
  function plantTaskDue(t) {
    if (!t || t.paused || t.dueOn === null || t.dueOn === undefined) return null;
    return Math.max(t.dueOn, t.snoozedUntil || -Infinity);
  }

  function relDue(day) {
    if (day === null) return 'Pause';
    const diff = day - S.today();
    if (diff < 0) return 'überfällig';
    if (diff === 0) return 'heute';
    if (diff === 1) return 'morgen';
    if (diff <= 30) return `in ${diff} Tagen`;
    const d = S.dayToDate(day);
    return `ab ${d.toLocaleDateString('de-DE', { month: 'long' })}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''}`;
  }

  function plantTasks(p) {
    return state.tasks.filter((t) => t.plantId === p.id);
  }

  /** Symbol einer Aufgabe in Listen: Foto der Pflanze, sonst das Raum-Symbol. */
  function taskIcon(t, r) {
    const p = t.plantId && plant(t.plantId);
    if (p && p.photo) return `<img class="room-icon plant-thumb" src="${p.photo}" alt="">`;
    return `<span class="room-icon">${r ? r.icon : t.plantId ? '🪴' : '🧽'}</span>`;
  }

  function plantsInRoomHint(r) {
    const n = (state.plants || []).filter((p) => p.roomId === r.id).length;
    return n ? `<button class="link" data-action="go" data-tab="plants">🪴 ${n} Pflanze${n === 1 ? '' : 'n'} – im Tab „Pflanzen“</button>` : '';
  }

  /** Draußen-Pflanzen, für die heute Nacht Frost droht. */
  function frostHint() {
    const w = plantWeather();
    const outdoor = (state.plants || []).filter((p) => P.isOutdoor(p) && !p.paused);
    if (!outdoor.length || !P.frostWarning(w)) return '';
    const names = outdoor.slice(0, 4).map((p) => esc(p.name)).join(', ') + (outdoor.length > 4 ? ' …' : '');
    return `<div class="hint frost"><span>❄️</span><div class="grow"><strong>Frost: bis ${Math.round(w.tmin)} °C</strong><br>
      <span class="muted small">Draußen: ${names} – reinholen oder abdecken.</span></div></div>`;
  }

  /** Eigener Block unter „Heute“, wenn Pflanzen nicht zum Putzplan zählen. */
  function todayPlantsBlock(doneIds) {
    if (S.plantsInPlan(state.settings)) return '';
    const today = S.today();
    const due = state.tasks.filter((t) => t.plantId && !doneIds.has(t.id) && S.isActive(t, today) && t.dueOn !== null && t.dueOn !== undefined && t.dueOn <= today);
    if (!due.length) return '';
    return `<section><h2>🪴 Pflanzen</h2><ul class="list">${due.map((t) => taskRow(t, t.assignee)).join('')}</ul></section>`;
  }

  // Texte der Rückmeldung je nachdem, wie gegossen wird.
  const FEEDBACK_TEXTS = {
    top: { q: 'Wie war die Erde vor dem Gießen?', skip: '🌊 Noch feucht – hab nicht gegossen', wet: '🌊 Noch feucht – trotzdem gegossen', ok: '👍 Oben trocken – passt', dry: '🏜️ Schon ganz trocken' },
    reservoir: { q: 'Wie stand die Wasserstandsanzeige?', skip: '🌊 Noch nicht leer – nicht aufgefüllt', wet: '🌊 Noch nicht leer – trotzdem aufgefüllt', ok: '👍 Leer – passt', dry: '🏜️ War schon länger leer', tip: 'Tipp: Steht die Anzeige auf „min.“, ruhig ein paar Tage warten, bevor du nachfüllst – dann bekommen die Wurzeln Luft.' },
    wick: { q: 'Wie voll war der Wasservorrat?', skip: '🌊 Noch nicht leer – nicht nachgefüllt', wet: '🌊 Noch nicht leer – trotzdem nachgefüllt', ok: '👍 Fast leer – passt', dry: '🏜️ Ganz leer' },
  };

  /** Fragt nach dem Gießen, wie die Erde war – daraus lernt die App das Intervall dieser Pflanze. */
  function plantFeedbackDialog(entryId) {
    const h = state.history.find((x) => x.id === entryId);
    const t = h && task(h.taskId);
    const p = t && plant(t.plantId);
    if (!p || document.querySelector('#modal-root .modal')) return;
    const mode = P.waterMode(p, h.day);
    const tx = FEEDBACK_TEXTS[mode] || FEEDBACK_TEXTS.top;
    openModal(`
      <h2>💧 ${esc(p.name)}</h2>
      <p class="muted">${tx.q}</p>
      <div class="menu">
        <button data-fb="ok">${tx.ok}</button>
        <button data-fb="wet">${tx.wet}</button>
        <button data-fb="skip">${tx.skip}</button>
        <button data-fb="dry">${tx.dry}</button>
        <button data-fb="none" class="muted">Überspringen</button>
      </div>
      ${tx.tip ? `<p class="small muted">${tx.tip}</p>` : ''}
      <p class="small muted">Deine Antwort passt das Intervall nur für diese Pflanze an – mit der Zeit wird es immer genauer.</p>`, (el) => {
      el.querySelectorAll('[data-fb]').forEach((b) => {
        b.onclick = () => { closeModal(); plantFeedback(entryId, p.id, b.dataset.fb); };
      });
    });
  }

  function plantFeedback(entryId, plantId, value) {
    const p = plant(plantId);
    if (!p || value === 'none') return;
    const today = S.today();
    if (value === 'skip') {
      // Nicht gegossen: Abhaken zurücknehmen, öfter nachsehen ist unnötig – Intervall verlängern.
      const h = state.history.find((x) => x.id === entryId);
      undoEntry(entryId, true);
      const s = state.session;
      if (s && h) {
        s.taskIds = s.taskIds.filter((id) => id !== h.taskId);
        if (!sessionOpenIds(s).length && !s.timeUp) s.allDone = !addBonusTask(true);
      }
      P.applyFeedback(p, 'wet');
      const days = P.recheckDays(p, today);
      p.waterNotBefore = today + days;
      syncPlants();
      save();
      render();
      toast(`Alles klar – ${p.name} kommt ${days === 1 ? 'morgen' : `in ${days} Tagen`} wieder dran 🌊`);
      return;
    }
    P.applyFeedback(p, value);
    syncPlants();
    save();
    render();
    const water = plantTasks(p).find((t) => t.plantCare === 'water');
    const next = water ? relDue(plantTaskDue(water)) : '';
    const msg = { wet: 'Wird künftig etwas seltener gegossen', dry: 'Wird künftig etwas öfter gegossen', ok: 'Danke!' }[value];
    toast(`${msg}${next ? ` · nächstes Mal ${next}` : ''}`);
  }

  // ------------------------------------------------ Ansicht „Pflanzen“

  function viewPlants() {
    const today = S.today();
    const plants = (state.plants || []).slice();
    const nextDue = (p) => Math.min(...plantTasks(p).map((t) => plantTaskDue(t) ?? Infinity));
    plants.sort((a, b) => nextDue(a) - nextDue(b) || a.name.localeCompare(b.name, 'de'));
    const dueCount = plants.filter((p) => nextDue(p) <= today).length;
    const ps = plantsSettings();
    const hasOutdoor = plants.some(P.isOutdoor);
    const w = plantWeather();

    let html = `<header class="page-head"><h1>Pflanzen</h1>
      <p class="muted">${plants.length ? `${plants.length} Pflanze${plants.length === 1 ? '' : 'n'}${dueCount ? ` · <strong class="bad-text">${dueCount} brauch${dueCount === 1 ? 't' : 'en'} heute etwas</strong>` : ' · alle versorgt 🌿'}` : 'Gießen nach Bedarf statt nach festen Terminen.'}</p></header>`;

    if (hasOutdoor && !ps.location) {
      html += `<div class="hint"><span>🌦️</span><div class="grow"><strong>Wetter für Balkon & Garten</strong><br>
        <span class="muted small">Trag deinen Ort ein – nach Regen fällt das Gießen dann aus, bei Hitze wird früher gegossen.</span></div>
        <button class="btn primary" data-action="go" data-tab="settings">Ort</button></div>`;
    } else if (hasOutdoor && w) {
      html += `<p class="small muted weather-line">📍 ${esc(ps.location.name)} · 🌧️ ${String(w.rain24).replace('.', ',')} mm in 24 Std. · 🌡️ bis ${Math.round(w.tmax)} °C, nachts ${Math.round(w.tmin)} °C</p>`;
    }
    html += frostHint();

    if (!plants.length) {
      html += `<div class="empty big"><div class="emoji">🪴</div>
        <p><strong>Noch keine Pflanzen</strong><br>Leg deine Pflanzen an – per Foto erkennt die App die Art.
        Die App rechnet aus, wann jede Pflanze Wasser, Dünger oder einen neuen Topf braucht.</p>
        <button class="btn primary" data-action="add-plant">＋ Erste Pflanze anlegen</button></div>`;
      return html;
    }

    html += `<ul class="list">${plants.map((p) => {
      const sp = P.species(p.species);
      const r = room(p.roomId);
      const tasks = plantTasks(p).sort((a, b) => ['water', 'feed', 'repot'].indexOf(a.plantCare) - ['water', 'feed', 'repot'].indexOf(b.plantCare));
      const dueTasks = tasks.filter((t) => { const d = plantTaskDue(t); return d !== null && d <= today; });
      const chips = tasks.map((t) => {
        const d = plantTaskDue(t);
        const late = d !== null && d <= today;
        return `<span class="badge ${late ? 'bad' : ''}">${CARE_ICONS[t.plantCare]} ${relDue(d)}</span>`;
      }).join('');
      return `<li class="row plant-row ${p.paused ? 'paused' : ''}">
        ${p.photo ? `<img class="plant-photo-sm" src="${p.photo}" alt="">` : `<span class="plant-photo-sm empty-photo">🪴</span>`}
        <div class="row-main" data-action="edit-plant" data-id="${p.id}">
          <div class="row-title">${esc(p.name)}</div>
          <div class="row-sub">${p.name !== sp.name ? `${esc(sp.name)} · ` : ''}${r ? `${r.icon} ${esc(r.name)}` : ''}${P.isOutdoor(p) ? ' · draußen' : ''}</div>
          <div class="row-sub care-chips">${chips}</div>
          ${dueTasks.length ? `<div class="care-actions">${dueTasks.map((t) => `<button class="btn small-btn" data-action="complete" data-id="${t.id}" data-member="${t.assignee || ''}">✓ ${CARE_ICONS[t.plantCare]} ${esc(careVerb(t))}</button>`
            + (t.plantCare === 'repot' ? '<button class="btn small-btn" data-action="shop-quick-key" data-key="blumenerde">🛒 Blumenerde</button>' : '')
            + (t.plantCare === 'feed' ? '<button class="btn small-btn" data-action="shop-quick-key" data-key="duenger">🛒 Dünger leer?</button>' : '')).join('')}</div>` : ''}
        </div>
      </li>`;
    }).join('')}</ul>
      <button class="btn primary block" data-action="add-plant">＋ Pflanze hinzufügen</button>
      <p class="muted small center">Tipp: Tippe nach dem Gießen kurz an, wie feucht die Erde war – so lernt die App jede Pflanze kennen.</p>`;
    return html;
  }

  function careVerb(t) {
    if (t.plantCare === 'feed') return 'Gedüngt';
    if (t.plantCare === 'repot') return 'Umgetopft';
    if (/Wasserspeicher/.test(t.name)) return 'Aufgefüllt';
    if (/nachfüllen/.test(t.name)) return 'Nachgefüllt';
    return 'Gegossen';
  }

  // ------------------------------------------------ Pflanze anlegen / bearbeiten

  let plantDraft = null;

  const OUTDOOR_RE = /balkon|garten|terrasse|draußen|draussen|hof|loggia/i;

  function defaultPlantRoom() {
    const rooms = state.rooms.filter((r) => !r.robot);
    const living = rooms.find((r) => /wohn/i.test(r.name));
    return (living || rooms[0] || { id: 'new:indoor' }).id;
  }

  function editPlant(plantId) {
    const p = plantId ? plant(plantId) : null;
    const today = S.today();
    plantDraft = p ? {
      id: p.id, name: p.name, nameTouched: true, species: p.species, speciesTouched: true, query: '',
      roomId: p.roomId || defaultPlantRoom(), location: p.location || 'indoor', light: p.light, size: p.size, pot: p.pot,
      fresh: P.inRampUp(p, today), customWater: p.customWater || '', photo: p.photo || null, paused: !!p.paused,
    } : {
      id: null, name: '', nameTouched: false, species: 'other', speciesTouched: false, query: '',
      roomId: defaultPlantRoom(), location: 'indoor', light: 'eastwest', size: 'm', pot: 'plastic',
      fresh: false, last: 'some', customWater: '', photo: null,
    };
    if (!p) plantDraft.location = OUTDOOR_RE.test((room(plantDraft.roomId) || {}).name || '') ? 'outdoor' : 'indoor';
    renderPlantDialog();
  }

  /** Vorschau: so oft wird mit den aktuellen Angaben gegossen. */
  function draftAsPlant(d) {
    const p = d.id ? plant(d.id) : null;
    return Object.assign({}, p || { learn: 1 }, {
      species: d.species, location: d.location, light: d.light, size: d.size, pot: d.pot,
      customWater: parseInt(d.customWater, 10) || undefined,
      plantedOn: d.pot === 'reservoir' && d.fresh ? (p && typeof p.plantedOn === 'number' && P.inRampUp(p, S.today()) ? p.plantedOn : S.today()) : undefined,
    });
  }

  function roomOptions(d) {
    const rooms = state.rooms.filter((r) => !r.robot);
    const opts = rooms.map((r) => `<option value="${r.id}" ${r.id === d.roomId ? 'selected' : ''}>${r.icon} ${esc(r.name)}</option>`);
    if (!rooms.length) opts.push(`<option value="new:indoor" ${d.roomId === 'new:indoor' ? 'selected' : ''}>🪴 Wohnung (neu)</option>`);
    if (!rooms.some((r) => /balkon/i.test(r.name))) opts.push(`<option value="new:balcony" ${d.roomId === 'new:balcony' ? 'selected' : ''}>🌿 Balkon (neu)</option>`);
    if (!rooms.some((r) => /garten/i.test(r.name))) opts.push(`<option value="new:garden" ${d.roomId === 'new:garden' ? 'selected' : ''}>🌳 Garten (neu)</option>`);
    return opts.join('');
  }

  function speciesResults(d) {
    if (!d.query.trim()) return '';
    const matches = P.search(d.query).slice(0, 8);
    if (!matches.length) return '<p class="small muted">Nichts gefunden – wähle „Andere Pflanze“ und stell das Intervall unten selbst ein.</p>';
    return `<div class="chip-grid">${matches.map((m) => `<button type="button" class="chip ${m.key === d.species ? 'on' : ''}" data-species="${m.key}">${esc(m.name)}</button>`).join('')}</div>`;
  }

  function identifyBlock(d) {
    const id = d.ident;
    if (!id) return '';
    if (id.busy) return '<p class="small muted">🔍 Erkenne die Pflanze …</p>';
    if (id.error) return `<p class="small bad-text">${esc(id.error)}</p>`;
    if (!id.results.length) return '<p class="small muted">Keine Pflanze erkannt – versuch ein Foto, auf dem Blätter oder Blüten gut zu sehen sind.</p>';
    const label = (r) => r.commonNames[0] || r.scientificName;
    const picked = typeof id.picked === 'number' ? id.results[id.picked] : null;
    // Nach der Auswahl: nur noch der übernommene Treffer – so sieht man, dass der Tipp gewirkt hat.
    if (picked && !id.open) {
      return `<div class="ident-picked"><span class="ident-check">✓</span>
        <div class="grow"><strong>${esc(label(picked))}</strong> übernommen<br>
          <span class="small muted">${picked.match ? `Steckbrief: ${esc(picked.match.name)}` : 'Standard-Profil – Intervall unten anpassbar'}</span></div>
        <button type="button" class="btn small-btn" data-ident-more>Andere Treffer</button></div>`;
    }
    return `<p class="small muted">Erkannt – tippe auf die richtige Art:</p>
      <div class="menu ident-list">${id.results.map((r, i) => `
        <button type="button" data-ident="${i}" class="${i === id.picked ? 'on' : ''}">
          <strong>${esc(label(r))}</strong> <span class="muted small">${Math.round(r.score * 100)} %</span>
          ${i === id.picked ? '<span class="badge good">✓ gewählt</span>' : ''}<br>
          <span class="small muted"><em>${esc(r.scientificName)}</em> · ${r.match ? `Steckbrief: ${esc(r.match.name)}` : 'nicht in den Steckbriefen – Standard-Profil'}</span>
        </button>`).join('')}</div>`;
  }

  function renderPlantDialog() {
    const d = plantDraft;
    if (!d) return;
    const today = S.today();
    const sp = P.species(d.species);
    const outdoor = d.location === 'outdoor';
    const preview = P.waterInterval(draftAsPlant(d), today, outdoor ? plantWeather() : null);
    const lights = P.LIGHTS.filter((l) => !(outdoor && l.indoorOnly));
    const existing = d.id ? plant(d.id) : null;
    const learned = existing && existing.learn && Math.abs(existing.learn - 1) > 0.01 ? existing.learn : null;
    const prevScroll = (document.querySelector('#modal-root .modal') || {}).scrollTop || 0;
    const chip = (attr, val, cur, label) => `<button type="button" class="chip ${val === cur ? 'on' : ''}" ${attr}="${val}">${label}</button>`;

    openModal(`
      <h2>${d.id ? 'Pflanze bearbeiten' : 'Neue Pflanze'}</h2>
      <div class="form">
        <div class="plant-photo">
          ${d.photo ? `<img src="${d.photo}" alt="">` : '<div class="plant-photo-empty">🪴</div>'}
          <div class="photo-btns">
            <label class="btn">📷 Foto aufnehmen<input type="file" accept="image/*" capture="environment" hidden data-photo></label>
            <label class="btn">🖼️ Aus der Galerie<input type="file" accept="image/*" hidden data-photo></label>
            ${d.blob ? `<button type="button" class="btn" data-identify ${d.ident && d.ident.busy ? 'disabled' : ''}>🔍 Art erkennen</button>` : ''}
          </div>
        </div>
        ${identifyBlock(d)}
        <label>Art<input class="input" type="search" data-species-q value="${esc(d.query)}" placeholder="🔍 Suchen, z. B. Monstera oder Ficus"></label>
        <div data-species-results>${speciesResults(d)}</div>
        <p class="small species-pick">Gewählt: <strong>${esc(sp.name)}</strong>${sp.latin ? ` <em class="muted">${esc(sp.latin)}</em>` : ''}
          ${d.species !== 'other' ? '<button type="button" class="link" data-species="other">Andere Pflanze</button>' : ''}</p>
        <label>Name<input class="input" data-plant-name value="${esc(d.name)}" placeholder="${esc(sp.name)}"></label>
        <label>Standort<select class="input" data-plant-room>${roomOptions(d)}</select></label>
        <label class="check-label"><input type="checkbox" data-plant-outdoor ${outdoor ? 'checked' : ''}> Steht draußen (Regen, Hitze & Frost berücksichtigen)</label>
        <div><span class="field-label">Licht</span>
          <div class="chip-grid">${lights.map((l) => chip('data-plant-light', l.key, d.light, outdoor ? (l.outName || l.name) : l.name)).join('')}</div></div>
        <div><span class="field-label">Topfgröße</span>
          <div class="chip-grid">${P.POT_SIZES.map((s) => chip('data-plant-size', s.key, d.size, s.name)).join('')}</div></div>
        <label>Topf<select class="input" data-plant-pot>${P.POT_TYPES.map((t) => `<option value="${t.key}" ${t.key === d.pot ? 'selected' : ''}>${t.name}</option>`).join('')}</select></label>
        ${d.pot === 'reservoir' ? `<p class="small muted">Topf mit eingebautem Wasserbecken und Wasserstandsanzeige. Du füllst den Speicher auf, die Erde zieht sich das Wasser selbst.
            Jedes vierte Mal zusätzlich von oben gießen – das spült Salze aus.</p>
          <label class="check-label"><input type="checkbox" data-plant-fresh ${d.fresh ? 'checked' : ''}> Frisch eingepflanzt – die ersten 12 Wochen von oben gießen (Angießphase)</label>` : ''}
        ${d.pot === 'wick' ? '<p class="small muted">Ein Docht oder Tonkegel zieht Wasser aus einem Vorrat in die Erde. Du füllst den Vorrat auf, nicht die Erde.</p>' : ''}
        ${d.id ? '' : `<div><span class="field-label">Zuletzt gegossen</span>
          <div class="chip-grid">${[['today', 'Heute'], ['some', 'Vor ein paar Tagen'], ['unknown', 'Weiß nicht']].map(([v, l]) => chip('data-plant-last', v, d.last, l)).join('')}</div></div>`}
        <details class="follow" ${d.customWater ? 'open' : ''}>
          <summary>Eigenes Grundintervall (optional)</summary>
          <p class="small muted">Steckbrief: alle ${sp.water} Tage im Sommer. Leer lassen, um den Steckbrief zu nutzen.</p>
          <label>Im Sommer alle … Tage gießen<input class="input" type="number" min="1" max="60" data-plant-custom value="${esc(d.customWater)}" placeholder="${sp.water}"></label>
        </details>
        <p class="small learned">💧 Mit diesen Angaben: zurzeit <strong>${intervalLabel(preview)}</strong> ${P.waterMode(draftAsPlant(d), today) === 'reservoir' ? 'Speicher auffüllen' : P.waterMode(draftAsPlant(d), today) === 'wick' ? 'Vorrat nachfüllen' : 'gießen'}.
          ${learned ? `<br>🎓 Aus deinen Rückmeldungen gelernt: ${learned > 1 ? `${Math.round((learned - 1) * 100)} % seltener` : `${Math.round((1 - learned) * 100)} % öfter`} als im Steckbrief.` : ''}</p>
        ${d.id ? `<label class="check-label"><input type="checkbox" data-plant-paused ${d.paused ? 'checked' : ''}> Pausieren (z. B. Pflanze ist bei Freunden in Pflege)</label>` : ''}
        <div class="btn-row">
          ${d.id ? '<button type="button" class="btn danger" data-del>Löschen</button>' : ''}
          <button type="button" class="btn" data-cancel>Abbrechen</button>
          <button type="button" class="btn primary" data-save>Speichern</button>
        </div>
      </div>`, (el) => {
      el.scrollTop = prevScroll;
      const rerender = () => renderPlantDialog();
      el.querySelectorAll('[data-photo]').forEach((inp) => {
        inp.onchange = () => { if (inp.files && inp.files[0]) choosePlantPhoto(inp.files[0]); };
      });
      const idBtn = el.querySelector('[data-identify]');
      if (idBtn) idBtn.onclick = () => identifyDraft();
      el.querySelectorAll('[data-ident]').forEach((b) => {
        b.onclick = () => {
          try {
            const i = +b.dataset.ident;
            const r = d.ident.results[i];
            pickSpecies(r.match ? r.match.key : 'other', r.commonNames[0] || r.scientificName);
            d.ident.picked = i;
            d.ident.open = false;
            rerender();
            const box = document.querySelector('#modal-root .ident-picked');
            if (box) box.scrollIntoView({ block: 'center' });
            toast(`✓ ${r.commonNames[0] || r.scientificName} übernommen`);
          } catch (e) {
            console.error(e);
            toast(`Das hat nicht geklappt: ${e && e.message ? e.message : e}`);
          }
        };
      });
      const more = el.querySelector('[data-ident-more]');
      if (more) more.onclick = () => { d.ident.open = true; rerender(); };
      // Suche: nur die Trefferliste neu zeichnen, damit Fokus und Tastatur bleiben.
      const q = el.querySelector('[data-species-q]');
      const results = el.querySelector('[data-species-results]');
      q.oninput = () => { d.query = q.value; results.innerHTML = speciesResults(d); };
      el.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-species]');
        if (!b) return;
        pickSpecies(b.dataset.species);
        d.query = '';
        rerender();
      });
      el.querySelector('[data-plant-name]').oninput = (ev) => { d.name = ev.target.value; d.nameTouched = !!ev.target.value.trim(); };
      el.querySelector('[data-plant-room]').onchange = (ev) => {
        d.roomId = ev.target.value;
        const name = ev.target.value === 'new:balcony' ? 'Balkon' : ev.target.value === 'new:garden' ? 'Garten' : (room(ev.target.value) || {}).name || '';
        d.location = OUTDOOR_RE.test(name) ? 'outdoor' : 'indoor';
        if (d.location === 'outdoor' && d.light === 'room') d.light = 'eastwest';
        rerender();
      };
      el.querySelector('[data-plant-outdoor]').onchange = (ev) => {
        d.location = ev.target.checked ? 'outdoor' : 'indoor';
        if (d.location === 'outdoor' && d.light === 'room') d.light = 'eastwest';
        rerender();
      };
      el.querySelectorAll('[data-plant-light]').forEach((b) => { b.onclick = () => { d.light = b.dataset.plantLight; rerender(); }; });
      el.querySelectorAll('[data-plant-size]').forEach((b) => { b.onclick = () => { d.size = b.dataset.plantSize; rerender(); }; });
      el.querySelectorAll('[data-plant-last]').forEach((b) => { b.onclick = () => { d.last = b.dataset.plantLast; rerender(); }; });
      el.querySelector('[data-plant-pot]').onchange = (ev) => { d.pot = ev.target.value; rerender(); };
      const fresh = el.querySelector('[data-plant-fresh]');
      if (fresh) fresh.onchange = () => { d.fresh = fresh.checked; rerender(); };
      const custom = el.querySelector('[data-plant-custom]');
      custom.onchange = () => { d.customWater = custom.value; rerender(); };
      const paused = el.querySelector('[data-plant-paused]');
      if (paused) paused.onchange = () => { d.paused = paused.checked; };
      el.querySelector('[data-cancel]').onclick = () => { plantDraft = null; closeModal(); };
      el.querySelector('[data-save]').onclick = savePlant;
      const del = el.querySelector('[data-del]');
      if (del) del.onclick = () => {
        if (!confirm(`„${d.name}“ wirklich löschen?`)) return;
        state.plants = state.plants.filter((x) => x.id !== d.id);
        syncPlants();
        plantDraft = null;
        save(); closeModal(); render();
      };
    });
  }

  function pickSpecies(key, suggestedName) {
    const d = plantDraft;
    d.species = key;
    d.speciesTouched = true;
    const sp = P.species(key);
    if (!d.nameTouched) d.name = key === 'other' && suggestedName ? suggestedName : sp.name;
    if (sp.out && !d.id && d.location === 'indoor' && !OUTDOOR_RE.test((room(d.roomId) || {}).name || '')) {
      // Typische Balkonpflanze – Standort nur vorschlagen, nicht erzwingen.
      toast(`${sp.name} steht meist draußen – Standort prüfen 🌿`);
    }
  }

  function roomForPlant(roomId) {
    const make = (name, icon) => {
      let r = state.rooms.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!r) { r = { id: uid(), name, icon }; state.rooms.push(r); }
      return r.id;
    };
    if (roomId === 'new:balcony') return make('Balkon', '🌿');
    if (roomId === 'new:garden') return make('Garten', '🌳');
    if (roomId === 'new:indoor') return make('Wohnung', '🪴');
    return roomId;
  }

  function savePlant() {
    const d = plantDraft;
    const today = S.today();
    const sp = P.species(d.species);
    const p = d.id ? plant(d.id) : { id: uid(), createdOn: today, learn: 1 };
    const tmp = draftAsPlant(d);
    Object.assign(p, {
      name: d.name.trim() || sp.name,
      species: d.species,
      roomId: roomForPlant(d.roomId),
      location: d.location,
      light: d.light,
      size: d.size,
      pot: d.pot,
      photo: d.photo || null,
      customWater: tmp.customWater,
      paused: !!d.paused,
    });
    if (d.pot === 'reservoir' && d.fresh) { if (!P.inRampUp(p, today)) p.plantedOn = today; } else delete p.plantedOn;
    if (!d.id) {
      const interval = P.waterInterval(p, today, plantWeather());
      p.lastWatered = d.last === 'today' ? today : d.last === 'some' ? today - Math.ceil(interval / 2) : null;
      // Dünger: nicht gleich am ersten Tag – die halbe Zeit gilt als erledigt.
      if (sp.feed) p.lastFed = today - Math.round(sp.feed / 2);
      state.plants.push(p);
    }
    syncPlants();
    plantDraft = null;
    save();
    closeModal();
    if (!d.id && P.isOutdoor(p)) refreshWeather(true);
    render();
    const water = plantTasks(p).find((t) => t.plantCare === 'water');
    toast(d.id ? `${p.name} gespeichert 🪴` : `${p.name} angelegt 🪴 · Gießen ${relDue(plantTaskDue(water))}`);
  }

  // ------------------------------------------------ Foto & Erkennung

  async function loadImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }

  /** Verkleinert ein Bild. `square`: mittig quadratisch zuschneiden (Vorschaubild). */
  function scaleImage(img, max, square) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const side = Math.min(w, h);
    const sw = square ? side : w;
    const sh = square ? side : h;
    const scale = Math.min(1, max / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    canvas.getContext('2d').drawImage(img, square ? (w - side) / 2 : 0, square ? (h - side) / 2 : 0, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function choosePlantPhoto(file) {
    const d = plantDraft;
    try {
      const img = await loadImage(file);
      // Kleines Vorschaubild bleibt auf dem Gerät, ein größeres Bild geht nur zur Erkennung.
      d.photo = scaleImage(img, 200, true).toDataURL('image/jpeg', 0.72);
      d.blob = await new Promise((res) => scaleImage(img, 1280, false).toBlob(res, 'image/jpeg', 0.85));
    } catch (e) {
      toast('Das Foto konnte nicht gelesen werden.');
      return;
    }
    if (plantDraft !== d) return;
    // Neue Pflanze ohne gewählte Art: gleich erkennen.
    if (!d.speciesTouched && d.blob) identifyDraft();
    else renderPlantDialog();
  }

  const IDENT_ERRORS = {
    not_configured: 'Die Foto-Erkennung ist noch nicht eingerichtet. Wähle die Art bitte über die Suche.',
    key_invalid: 'Die Foto-Erkennung ist gerade nicht verfügbar (Schlüssel ungültig).',
    quota: 'Für heute sind alle Foto-Erkennungen aufgebraucht – morgen geht es wieder.',
    bad_image: 'Das Foto ist zu groß oder kein Bild.',
  };

  async function identifyDraft() {
    const d = plantDraft;
    if (!d || !d.blob) return;
    d.ident = { busy: true };
    renderPlantDialog();
    try {
      const fd = new FormData();
      fd.append('images', d.blob, 'pflanze.jpg');
      fd.append('organs', 'auto');
      const res = await fetch(Shared.PLANT_ID_API, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(IDENT_ERRORS[data.error] || `Erkennung fehlgeschlagen (${res.status}).`);
      const results = (data.results || []).map((r) => Object.assign({}, r, {
        commonNames: r.commonNames || [],
        match: P.matchSpecies(r.scientificName, r.genus, r.family),
      }));
      d.ident = { results };
      // Sichere Treffer gleich übernehmen.
      const top = results[0];
      if (top && top.score >= 0.25 && !d.speciesTouched) {
        pickSpecies(top.match ? top.match.key : 'other', top.commonNames[0] || top.scientificName);
        d.speciesTouched = false; // weitere Fotos dürfen die Art noch ändern
        d.ident.picked = 0;
        d.ident.open = true; // Liste offen lassen – man kann noch einen anderen Treffer wählen
      }
    } catch (e) {
      d.ident = { error: /fetch|network|load failed/i.test(String(e && e.message)) ? 'Keine Verbindung – die Foto-Erkennung braucht Internet.' : e.message };
    }
    if (plantDraft === d) renderPlantDialog();
  }

  // ------------------------------------------------ Einstellungen & Wetter

  function plantsCard() {
    const ps = plantsSettings();
    const w = plantWeather();
    const results = ui.locResults || [];
    return `<section class="card">
        <h2>🪴 Pflanzen</h2>
        <p class="muted small">Deine Pflanzen legst du im Tab „Pflanzen“ an. Gegossen wird nach Bedarf: Art, Topf, Licht,
          Jahreszeit, Wetter und deine Rückmeldung bestimmen den Termin.</p>
        <label class="switch-row"><span>Pflanzen im Putzplan mitzählen<br>
          <span class="muted small">Zeitbudget, Putz-Timer und Punkte. Aus: eigener Block unter „Heute“.</span></span>
          <input type="checkbox" class="switch" data-plants-inplan ${S.plantsInPlan(state.settings) ? 'checked' : ''}></label>
        <p><strong>Ort für das Wetter</strong><br><span class="muted small">Für Pflanzen auf Balkon und im Garten: Nach Regen fällt
          das Gießen aus, bei Hitze wird früher gegossen, bei Frost gibt es einen Hinweis. Wetterdaten von Open-Meteo.</span></p>
        ${ps.location ? `<p class="small">📍 <strong>${esc(ps.location.name)}</strong>${ps.location.region ? ` <span class="muted">${esc(ps.location.region)}</span>` : ''}
          ${w ? `<br>🌧️ ${String(w.rain24).replace('.', ',')} mm in 24 Std. · 🌡️ bis ${Math.round(w.tmax)} °C, nachts ${Math.round(w.tmin)} °C` : ''}
          <button class="link" data-action="plant-loc-clear">Entfernen</button></p>` : ''}
        <div class="inline-form">
          <input class="input" type="search" data-plant-loc-q value="${esc(ui.locQuery || '')}" placeholder="Ort, z. B. München">
          <button class="btn" data-action="plant-loc-search">Suchen</button>
        </div>
        ${ui.locError ? `<p class="small bad-text">${esc(ui.locError)}</p>` : ''}
        ${results.length ? `<div class="menu loc-list">${results.map((r, i) => `<button data-action="plant-loc-pick" data-i="${i}">📍 ${esc(r.name)} <span class="muted small">${esc([r.admin1, r.country].filter(Boolean).join(', '))}</span></button>`).join('')}</div>` : ''}
      </section>`;
  }

  async function searchPlantLocation() {
    const q = (ui.locQuery || '').trim();
    if (!q) return;
    ui.locError = null;
    try {
      const res = await fetch(P.geocodeUrl(q));
      const data = await res.json();
      ui.locResults = data.results || [];
      if (!ui.locResults.length) ui.locError = 'Kein Ort gefunden.';
    } catch (e) {
      ui.locResults = [];
      ui.locError = 'Keine Verbindung – bitte später nochmal versuchen.';
    }
    render();
  }

  function pickPlantLocation(i) {
    const r = (ui.locResults || [])[i];
    if (!r) return;
    plantsSettings().location = { name: r.name, region: [r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude };
    plantsSettings().weather = null;
    ui.locResults = [];
    ui.locQuery = '';
    save();
    render();
    refreshWeather(true);
    toast(`📍 ${r.name} gespeichert`);
  }

  /** Wetter holen – höchstens alle 3 Stunden und nur, wenn eine Pflanze draußen steht. */
  async function refreshWeather(force) {
    const ps = plantsSettings();
    if (!ps.location || weatherBusy) return;
    if (!force && !(state.plants || []).some(P.isOutdoor)) return;
    if (!force && ps.weather && Date.now() - ps.weather.at < WEATHER_EVERY_MS) return;
    weatherBusy = true;
    try {
      const res = await fetch(P.weatherUrl(ps.location.lat, ps.location.lon));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const w = P.parseWeather(await res.json(), Date.now());
      if (w) {
        ps.weather = w;
        syncPlants();
        save();
        if (!document.querySelector('#modal-root .modal')) render();
      }
    } catch (e) {
      // Ohne Internet wird ohne Wetter weitergerechnet.
    } finally {
      weatherBusy = false;
    }
  }

  // ---------------------------------------------------------------- Allergiker-Modus

  function allergy() {
    if (!state.settings.allergy) state.settings.allergy = { enabled: false, types: [] };
    return state.settings.allergy;
  }

  /** Raum für eine Zusatzaufgabe: erster passender Raum, sonst „Allgemein“, sonst ein neuer Raum. */
  function roomForAllergyTask(prefs) {
    const rooms = state.rooms.filter((r) => !r.robot);
    for (const pref of prefs.concat(['Allgemein'])) {
      const hit = rooms.find((r) => r.name.toLowerCase().includes(pref.toLowerCase()));
      if (hit) return hit;
    }
    let r = state.rooms.find((x) => x.allergyRoom);
    if (!r) {
      r = { id: uid(), name: 'Allergie', icon: '🤧', allergyRoom: true };
      state.rooms.push(r);
    }
    return r;
  }

  /** Legt Zusatzaufgaben für die gewählten Allergien an bzw. pausiert sie. */
  function syncAllergyTasks() {
    const a = allergy();
    const today = S.today();
    for (const [key, name, interval, minutes, type, prefs] of T.ALLERGY_TASKS) {
      const on = a.enabled && a.types.includes(type);
      const existing = state.tasks.find((t) => t.allergyKey === key);
      if (existing) existing.paused = !on;
      else if (on) {
        state.tasks.push({
          id: uid(), roomId: roomForAllergyTask(prefs).id, name, interval, minutes, allergyKey: key,
          season: type === 'pollen' ? 'pollen' : undefined,
          lastDone: today - Math.ceil(interval / 2), assignee: null, paused: false, snoozedUntil: null,
        });
      }
    }
  }

  /** Aufgabe wird wegen einer Allergie öfter fällig? */
  function allergyBoosted(t) {
    return S.effectiveInterval(t, state.settings) < t.interval;
  }

  function intervalText(t) {
    if (t.trigger) return '↪ Folgeaufgabe';
    const eff = S.effectiveInterval(t, state.settings);
    return eff < t.interval ? `🤧 ${intervalLabel(eff)}` : intervalLabel(t.interval);
  }

  function allergyCard() {
    const a = allergy();
    const today = S.today();
    const boosted = a.enabled ? state.tasks.filter((t) => !t.paused && !t.archived && allergyBoosted(t)) : [];
    const extra = state.tasks.filter((t) => t.allergyKey && !t.paused).length;
    const pollenNote = a.types.includes('pollen')
      ? `<p class="small">🌼 Pollensaison ${S.isPollenSeason(today) ? '<strong>läuft</strong> – Pollen-Aufgaben sind aktiv.' : 'ist vorbei – Pollen-Aufgaben ruhen bis Februar.'}</p>` : '';
    return `<section class="card">
        <h2>🤧 Allergiker-Modus</h2>
        <p class="muted small">Für Allergiker werden Bettwäsche, Polster, Couch, Saugen & Co. öfter eingeplant,
          und passende Zusatzaufgaben kommen dazu.</p>
        <label class="switch-row"><span>Allergiker-Modus</span>
          <input type="checkbox" class="switch" data-allergy-toggle ${a.enabled ? 'checked' : ''}></label>
        ${a.enabled ? `
          <p class="small muted">Wogegen bist du allergisch?</p>
          <div class="chip-grid">${T.ALLERGIES.map((x) => `<button class="chip ${a.types.includes(x.key) ? 'on' : ''}" data-action="allergy-type" data-key="${x.key}">${x.icon} ${x.name}</button>`).join('')}</div>
          ${pollenNote}
          ${a.types.length ? `<p class="small">✨ <strong>${boosted.length}</strong> Aufgabe${boosted.length === 1 ? ' wird' : 'n werden'} öfter fällig (🤧),
            <strong>${extra}</strong> Zusatzaufgabe${extra === 1 ? '' : 'n'}.</p>
          ${a.types.map((type) => {
            const info = T.ALLERGIES.find((x) => x.key === type);
            return `<details class="follow tips"><summary>${info.icon} Tipps bei ${info.name}</summary>
              <ul class="small">${T.ALLERGY_TIPS[type].map((tip) => `<li>${esc(tip)}</li>`).join('')}</ul></details>`;
          }).join('')}
          <p class="muted small">Allgemeine Tipps – sie ersetzen keine ärztliche Beratung.</p>` : '<p class="small muted">Wähle mindestens eine Allergie aus.</p>'}` : ''}
      </section>`;
  }

  function setAllergy(changes) {
    Object.assign(allergy(), changes);
    syncAllergyTasks();
    save();
    render();
  }

  function toggleAllergyType(key) {
    const a = allergy();
    const types = a.types.includes(key) ? a.types.filter((t) => t !== key) : a.types.concat(key);
    setAllergy({ types });
    const info = T.ALLERGIES.find((x) => x.key === key);
    if (types.includes(key)) toast(`${info.icon} ${info.name}: Plan angepasst`);
  }

  // ---------------------------------------------------------------- Saug- & Wischroboter

  function robot() {
    if (!state.settings.robot) state.settings.robot = { vacuum: false, mop: false, excludedRooms: [] };
    return state.settings.robot;
  }

  function robotEnabled() {
    const r = state.settings.robot;
    return !!(r && (r.vacuum || r.mop));
  }

  /**
   * Legt die Wartungsaufgaben für den Roboter an (eigener Raum „Roboter“) bzw.
   * pausiert sie, wenn der passende Roboter ausgeschaltet wird.
   */
  function syncRobotTasks() {
    const r = robot();
    let robotRoom = state.rooms.find((x) => x.robot);
    if (!robotRoom && !robotEnabled()) return;
    if (!robotRoom) {
      robotRoom = { id: uid(), name: 'Roboter', icon: '🤖', robot: true };
      state.rooms.push(robotRoom);
    }
    const today = S.today();
    for (const [key, name, interval, minutes, type] of T.ROBOT_TASKS) {
      const existing = state.tasks.find((t) => t.robotKey === key);
      if (existing) existing.paused = !r[type];
      else if (r[type]) {
        state.tasks.push({
          id: uid(), roomId: robotRoom.id, name, interval, minutes, robotKey: key, floor: '',
          lastDone: today - Math.floor(interval / 2), assignee: null, paused: false, snoozedUntil: null,
        });
      }
    }
  }

  function robotCard() {
    const r = robot();
    const floorRooms = state.rooms.filter((rm) => !rm.robot && state.tasks.some((t) => t.roomId === rm.id && S.floorType(t)));
    const covered = (rm) => !(r.excludedRooms || []).includes(rm.id);
    const handled = state.tasks.filter((t) => S.robotHandles(t, state.settings));
    const savedMin = handled.reduce((sum, t) => sum + (S.estimate(t) * 7) / t.interval, 0);
    return `<section class="card">
        <h2>🤖 Saug- & Wischroboter</h2>
        <p class="muted small">Hast du einen Roboter, fallen Staubsaugen bzw. Boden wischen aus deinem Putzplan.
          Dafür kommen kurze Wartungsaufgaben dazu (Behälter leeren, Bürsten reinigen …).</p>
        <label class="switch-row"><span>Saugroboter</span>
          <input type="checkbox" class="switch" data-robot="vacuum" ${r.vacuum ? 'checked' : ''}></label>
        <label class="switch-row"><span>Wischroboter</span>
          <input type="checkbox" class="switch" data-robot="mop" ${r.mop ? 'checked' : ''}></label>
        ${robotEnabled() && floorRooms.length ? `
          <p class="small muted">In welchen Räumen fährt der Roboter?</p>
          <div class="chip-grid">${floorRooms.map((rm) => `<button class="chip ${covered(rm) ? 'on' : ''}" data-action="robot-room" data-id="${rm.id}">${rm.icon} ${esc(rm.name)}</button>`).join('')}</div>` : ''}
        ${robotEnabled() ? `<p class="small">✨ Der Roboter übernimmt <strong>${handled.length} Aufgabe${handled.length === 1 ? '' : 'n'}</strong>
          – das spart dir ca. <strong>${fmtMinutes(Math.round(savedMin))}</strong> pro Woche.</p>` : ''}
      </section>`;
  }

  function setRobot(type, on) {
    robot()[type] = on;
    syncRobotTasks();
    save();
    render();
    toast(on ? `${type === 'mop' ? 'Wischroboter' : 'Saugroboter'} aktiv – Boden-Aufgaben sind raus aus dem Plan 🤖`
      : `${type === 'mop' ? 'Wischroboter' : 'Saugroboter'} aus – Boden-Aufgaben sind wieder im Plan`);
  }

  function toggleRobotRoom(roomId) {
    const r = robot();
    const list = (r.excludedRooms || []).slice();
    const idx = list.indexOf(roomId);
    if (idx >= 0) list.splice(idx, 1); else list.push(roomId);
    r.excludedRooms = list;
    save();
    render();
  }

  // ---------------------------------------------------------------- Installation & Erinnerungen

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let installPrompt = null;

  function isStandalone() {
    return Native.isNative || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  function reminder() {
    if (!state.settings.reminder) state.settings.reminder = { enabled: false, time: '08:00' };
    return state.settings.reminder;
  }

  function installCard() {
    if (isStandalone()) return '';
    let how;
    if (installPrompt) {
      how = '<button class="btn primary block" data-action="install">📲 Jetzt installieren</button>';
    } else if (isIOS) {
      how = `<ol class="steps">
          <li>Diese Seite in <strong>Safari</strong> öffnen</li>
          <li>Unten auf <strong>Teilen</strong> <span class="kbd">⬆︎</span> tippen</li>
          <li><strong>„Zum Home-Bildschirm“</strong> wählen und <strong>Hinzufügen</strong></li>
          <li>Putzplan über das neue Symbol öffnen – dann gehen auch Erinnerungen</li></ol>`;
    } else {
      how = `<ol class="steps">
          <li>Browser-Menü <span class="kbd">⋮</span> öffnen</li>
          <li><strong>„App installieren“</strong> bzw. <strong>„Zum Startbildschirm hinzufügen“</strong> wählen</li></ol>`;
    }
    return `<section class="card">
        <h2>📲 Als App installieren</h2>
        <p class="muted small">Putzplan landet als Symbol auf deinem Startbildschirm, startet ohne Browserleiste und funktioniert offline.</p>
        ${how}
      </section>`;
  }

  function reminderCard() {
    const r = reminder();
    let note = '';
    if (Native.isNative) {
      if (ui.notifPermission === 'denied') {
        note = '<p class="note">Benachrichtigungen sind für Putzplan ausgeschaltet. Erlaube sie unter Android-Einstellungen → Apps → Putzplan → Benachrichtigungen.</p>';
      } else if (r.enabled && ui.exactAlarm === 'denied') {
        note = `<p class="note">Damit die Erinnerung pünktlich kommt, erlaube Putzplan „Wecker und Erinnerungen“.
          <button class="link" data-action="exact-alarm">Jetzt erlauben ›</button></p>`;
      }
    } else if (!pushSupported) {
      note = isIOS && !isStandalone()
        ? '<p class="note">Auf iPhone/iPad funktionieren Erinnerungen nur in der installierten App (iOS 16.4 oder neuer). Installiere Putzplan zuerst wie oben beschrieben.</p>'
        : '<p class="note">Dieser Browser unterstützt leider keine Push-Benachrichtigungen.</p>';
    } else if (Notification.permission === 'denied') {
      note = '<p class="note">Benachrichtigungen sind für Putzplan blockiert. Erlaube sie in den Einstellungen deines Browsers bzw. Handys.</p>';
    }
    let preview = '';
    if (state.tasks.length) {
      const msg = Shared.reminderMessage(state, S);
      preview = `<div class="notif-preview"><img src="icons/icon-192.png" alt=""><div><strong>${esc(msg.title)}</strong><br><span>${esc(msg.body).replace(/\n/g, '<br>')}</span></div></div>`;
    }
    return `<section class="card">
        <h2>🔔 Tägliche Erinnerung</h2>
        <p class="muted small">Jeden Tag zur gewählten Uhrzeit eine Benachrichtigung mit deinen Aufgaben für heute – auch wenn die App geschlossen ist.${Native.isNative ? ' Läuft komplett auf deinem Handy, ohne Internet.' : ''}</p>
        <label class="switch-row">
          <span>Erinnerung ${r.enabled ? 'an' : 'aus'}</span>
          <input type="checkbox" class="switch" data-reminder-toggle ${r.enabled ? 'checked' : ''} ${reminderSupported() && !ui.reminderBusy ? '' : 'disabled'}>
        </label>
        <label class="switch-row">
          <span>Uhrzeit</span>
          <input type="time" class="input time-input" value="${r.time}" data-reminder-time ${ui.reminderBusy ? 'disabled' : ''}>
        </label>
        ${note}
        ${r.enabled ? '<button class="btn block" data-action="reminder-test">Test-Benachrichtigung senden</button>' : ''}
        ${preview ? `<p class="muted small">So sieht die Erinnerung heute aus:</p>${preview}` : ''}
      </section>`;
  }

  function reminderSupported() {
    return Native.isNative || pushSupported;
  }

  // Status der Android-Berechtigungen für die Anzeige in den Einstellungen.
  async function refreshNativeStatus() {
    if (!Native.isNative) return;
    try {
      const before = ui.notifPermission + ui.exactAlarm;
      ui.notifPermission = await Native.notificationPermission(false);
      ui.exactAlarm = await Native.exactAlarmStatus();
      if (before !== ui.notifPermission + ui.exactAlarm && ui.tab === 'settings') render();
    } catch (e) { /* ignorieren */ }
  }

  async function pushApi(path, body) {
    const res = await fetch(Shared.PUSH_API + path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function base64UrlToBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  async function pushSubscription(create) {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub && create) {
      const { publicKey } = await pushApi('/config');
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
    }
    return sub;
  }

  async function registerReminder() {
    const sub = await pushSubscription(true);
    await pushApi('/subscribe', {
      subscription: sub.toJSON(),
      time: reminder().time,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin',
    });
  }

  async function withBusy(fn) {
    ui.reminderBusy = true;
    render();
    try {
      await fn();
    } catch (e) {
      console.warn(e);
      toast('Das hat nicht geklappt – bist du online? (' + e.message + ')');
    } finally {
      ui.reminderBusy = false;
      render();
    }
  }

  function enableReminder() {
    return withBusy(async () => {
      if (Native.isNative) {
        const perm = await Native.notificationPermission(true);
        ui.notifPermission = perm;
        if (perm !== 'granted') {
          toast('Ohne Erlaubnis für Benachrichtigungen geht es leider nicht.');
          return;
        }
        reminder().enabled = true;
        save();
        ui.exactAlarm = await Native.exactAlarmStatus();
        toast(`Erinnerung aktiv – täglich um ${reminder().time} Uhr 🔔`);
        return;
      }
      if (!pushSupported) throw new Error('nicht unterstützt');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        toast('Ohne Erlaubnis für Benachrichtigungen geht es leider nicht.');
        return;
      }
      await registerReminder();
      reminder().enabled = true;
      save();
      toast(`Erinnerung aktiv – täglich um ${reminder().time} Uhr 🔔`);
    });
  }

  function disableReminder() {
    return withBusy(async () => {
      reminder().enabled = false;
      save();
      if (Native.isNative) {
        toast('Erinnerung ausgeschaltet');
        return;
      }
      const sub = await pushSubscription(false);
      if (sub) {
        await pushApi('/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
      }
      toast('Erinnerung ausgeschaltet');
    });
  }

  // Beim Start den Server abgleichen (z. B. neue Zeitzone oder vom Browser erneuertes Abo).
  async function resyncReminder() {
    if (!reminder().enabled || !pushSupported || Notification.permission !== 'granted') return;
    try {
      await registerReminder();
    } catch (e) {
      console.warn('Erinnerung konnte nicht abgeglichen werden', e);
    }
  }

  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    installPrompt = ev;
    if (ui.tab === 'settings') render();
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    toast('Putzplan wurde installiert 🎉');
    render();
  });

  // ---------------------------------------------------------------- Import / Export

  function exportData() {
    const filename = `putzplan-${new Date().toISOString().slice(0, 10)}.json`;
    if (Native.isNative) {
      Native.shareExport(filename, JSON.stringify(state, null, 2)).catch((e) => {
        if (!/cancel/i.test(String(e && e.message))) toast('Export fehlgeschlagen');
      });
      return;
    }
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      try {
        const data = JSON.parse(await input.files[0].text());
        if (!Array.isArray(data.tasks) || !Array.isArray(data.rooms)) throw new Error('Format');
        if (isCloudHousehold() && !confirm('Der Import ersetzt die Daten dieses Haushalts – für alle Mitglieder. Fortfahren?')) return;
        data.session = null;
        state = Object.assign(defaultState(), data);
        migrate();
        save(); render();
        toast('Daten importiert ✅');
      } catch (e) {
        toast('Die Datei konnte nicht gelesen werden.');
      }
    };
    input.click();
  }

  // ---------------------------------------------------------------- Rendering & Events

  /**
   * Bringt Daten älterer Versionen (oder aus einem Import) auf den aktuellen Stand.
   * Läuft erst, wenn alle Funktionen der App bereitstehen.
   */
  function migrate() {
    if (!state.settings) state.settings = defaultState().settings;
    if (!Array.isArray(state.plants)) state.plants = [];
    if (!state.settings.perPersonBudget) {
      // Bisher gab es ein gemeinsames Budget für alle – jetzt hat jede Person ihr eigenes.
      // Aufteilen, damit der Plan insgesamt gleich viel Zeit vorsieht wie vorher.
      const n = state.members.length;
      const base = state.settings.minutesPerWeekday || [20, 20, 20, 20, 20, 60, 0];
      for (const m of state.members) {
        if (!Array.isArray(m.minutesPerWeekday)) m.minutesPerWeekday = base.map((v) => (n > 1 ? Math.round(v / n / 5) * 5 : v));
      }
      state.settings.perPersonBudget = true;
    }
    if (!Array.isArray(state.shoppingLists)) state.shoppingLists = [];
    if (!Array.isArray(state.shoppingItems)) state.shoppingItems = [];
    syncPlants();
    if (!state.settings.autoFollowUps) {
      state.settings.autoFollowUps = true;
      state.tasks.slice().forEach((t) => autoFollowUp(t));
      if (state.onboarded) save();
    }
  }

  // Sicherheitsnetz: Statt eines leeren Bildschirms eine Meldung mit Ausweg anzeigen.
  function showError(e) {
    console.error(e);
    const view = document.getElementById('view');
    if (!view) return;
    view.innerHTML = `<div class="empty big"><div class="emoji">😵</div>
      <p><strong>Da ist etwas schiefgelaufen.</strong><br>Deine Daten sind sicher gespeichert.</p>
      <p class="small muted">${esc(e && e.message ? e.message : e)}</p>
      <div class="btn-row">
        <button class="btn" data-action="export">⬇︎ Daten sichern</button>
        <button class="btn primary" data-action="reload">Neu laden</button>
      </div></div>`;
  }

  function render() {
    try {
      renderView();
    } catch (e) {
      showError(e);
    }
  }

  function renderView() {
    const view = document.getElementById('view');
    const tabs = document.getElementById('tabs');
    if (!state.onboarded) {
      tabs.hidden = true;
      view.innerHTML = viewOnboarding();
      return;
    }
    tabs.hidden = false;
    const activeTab = ui.tab === 'team' ? 'settings' : ui.tab;
    tabs.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === activeTab));
    const views = { today: viewToday, week: viewWeek, plants: viewPlants, shop: viewShopping, rooms: viewRooms, team: viewTeam, settings: viewSettings };
    const badge = document.getElementById('shop-badge');
    if (badge) { const n = openCount(); badge.textContent = n > 99 ? '99+' : String(n); badge.hidden = !n; }
    if (state.session && ui.tab === 'today') views.today = viewSession;
    view.innerHTML = views[ui.tab]();
    ensureSessionTimer();
  }

  async function finishOnboarding() {
    const keys = ui.onboardRooms || new Set();
    const newHousehold = !!ui.newHousehold;
    T.ROOM_TEMPLATES.filter((r) => keys.has(r.key)).forEach((r) => addRoomFromTemplate(r, true));
    // Neuer Haushalt mit Konto: Ich bin schon Mitglied (erster Name), die übrigen kommen dazu.
    (ui.onboardMembers || []).map((n) => n.trim()).filter(Boolean).forEach((name, i) => {
      if (newHousehold && i === 0 && state.members.length) return;
      state.members.push({ id: uid(), name, color: T.MEMBER_COLORS[i % T.MEMBER_COLORS.length], offDays: [] });
    });
    const m = ui.onboardMinutes || 20;
    state.settings.minutesPerWeekday = [m, m, m, m, m, m * 3, 0];
    const rb = ui.onboardRobot || {};
    state.settings.robot = { vacuum: !!rb.vacuum, mop: !!rb.mop, excludedRooms: [] };
    syncRobotTasks();
    const al = ui.onboardAllergy || [];
    state.settings.allergy = { enabled: al.length > 0, types: al };
    syncAllergyTasks();
    state.onboarded = true;
    ui = { tab: 'today', roomId: null, showMore: false };
    if (cloud.user && activeId === 'local') {
      // Mit Konto eingerichtet: gleich als Haushalt im Konto anlegen (erster Name = ich).
      try {
        await moveLocalToCloud(state.members[0] ? state.members[0].id : null);
      } catch (e) {
        save();
        render();
        toast(`Gespeichert auf dem Handy – Konto-Abgleich klappt später (${Cloud.friendly(e)})`);
      }
      return;
    }
    save();
    render();
    toast('Dein Putzplan ist fertig! 🧽');
  }

  document.addEventListener('click', (ev) => {
    const tabBtn = ev.target.closest('#tabs [data-tab]');
    if (tabBtn) {
      ui.tab = tabBtn.dataset.tab;
      ui.roomId = null;
      render();
      window.scrollTo(0, 0);
      return;
    }
    const el = ev.target.closest('#view [data-action]');
    if (!el) return;
    const { action, id } = el.dataset;
    switch (action) {
      case 'go': ui.tab = el.dataset.tab; render(); break;
      case 'complete': completeTask(id, el.dataset.member || task(id).assignee); break;
      case 'task-menu': taskMenu(id, el.dataset.member || null); break;
      case 'undo': undoEntry(id); break;
      case 'toggle-more': ui.showMore = !ui.showMore; render(); break;
      case 'edit-task': editTask(id); break;
      case 'add-task': editTask(null, el.dataset.room); break;
      case 'open-room': ui.roomId = id; render(); window.scrollTo(0, 0); break;
      case 'close-room': ui.roomId = null; render(); break;
      case 'add-room': addRoom(); break;
      case 'edit-room': editRoom(id); break;
      case 'add-member': editMember(null); break;
      case 'edit-member': editMember(id); break;
      case 'export': exportData(); break;
      case 'reload': location.reload(); break;
      case 'import': importData(); break;
      case 'install':
        if (installPrompt) {
          installPrompt.prompt();
          installPrompt.userChoice.finally(() => { installPrompt = null; render(); });
        }
        break;
      case 'dismiss-install': state.settings.installHintDismissed = true; save(); render(); break;
      case 'update-install': installUpdate(); break;
      case 'update-check': checkForUpdate(true); break;
      case 'allergy-type': toggleAllergyType(el.dataset.key); break;
      case 'onboard-allergy': {
        const k = el.dataset.key;
        const cur = ui.onboardAllergy || [];
        ui.onboardAllergy = cur.includes(k) ? cur.filter((x) => x !== k) : cur.concat(k);
        render();
        break;
      }
      case 'robot-room': toggleRobotRoom(id); break;
      case 'add-plant': editPlant(null); break;
      case 'today-scope': ui.todayScope = el.dataset.scope; render(); break;
      case 'shop-done': shopDone(id); break;
      case 'shop-edit': ev.stopPropagation(); shopItemDialog(id); break;
      case 'shop-add-item': {
        const it = shopItem(id);
        if (it) { addShopItem(it, it.listId); save(); render(); }
        break;
      }
      case 'shop-add-key': {
        const c = Sh.item(el.dataset.key);
        if (c) {
          addShopItem({ name: c.name, key: c.key, cat: c.cat, icon: c.icon }, currentList().id);
          ui.shopQuery = '';
          save();
          render();
        }
        break;
      }
      case 'shop-add-free': addFromQuery(); break;
      case 'shop-list': ui.shopListId = id; ui.shopQuery = ''; render(); break;
      case 'shop-list-new': shopListDialog(null); break;
      case 'shop-list-edit': shopListDialog(currentList().id); break;
      case 'shop-quick-key': {
        const c = Sh.item(el.dataset.key);
        if (c) { addShopItem({ name: c.name, key: c.key, cat: c.cat, icon: c.icon }, shopLists()[0].id); save(); render(); }
        break;
      }
      case 'session-shop': {
        const s = state.session;
        const names = s ? s.taskIds.map((tid) => (task(tid) || {}).name || '').join(' ') : '';
        shopQuickDialog('Was ist leer?', Sh.suggestionsFor(names));
        break;
      }
      case 'edit-plant': editPlant(id); break;
      case 'plant-loc-search': searchPlantLocation(); break;
      case 'plant-loc-pick': pickPlantLocation(+el.dataset.i); break;
      case 'plant-loc-clear': plantsSettings().location = null; plantsSettings().weather = null; syncPlants(); save(); render(); break;
      case 'session-start': startSessionDialog(); break;
      case 'session-toggle': sessionToggle(id); break;
      case 'session-pause': togglePause(); break;
      case 'session-end': confirmEndSession(); break;
      case 'session-extend': extendSession(5); break;
      case 'session-finish': endSession(true); break;
      case 'session-add': sessionAddDialog(); break;
      case 'session-swap': sessionSwapDialog(id); break;
      case 'session-more':
        if (!addBonusTask(false)) toast('Gerade passt keine weitere Aufgabe in die Restzeit.');
        save(); render();
        break;
      case 'exact-alarm': Native.openExactAlarmSettings(); break;
      case 'reminder-test':
        if (Native.isNative) {
          Native.testNotification(state, Shared, S)
            .then(() => toast('Test-Benachrichtigung kommt in 5 Sekunden 📬'))
            .catch(() => toast('Test fehlgeschlagen'));
          break;
        }
        withBusy(async () => {
          const sub = await pushSubscription(false);
          if (!sub) throw new Error('Gerät nicht angemeldet');
          await pushApi('/test', { endpoint: sub.endpoint });
          toast('Test-Benachrichtigung ist unterwegs 📬');
        });
        break;
      case 'reset':
        if (confirm('Wirklich alle Räume, Aufgaben und den Verlauf löschen?')) {
          state = defaultState(); ui = { tab: 'today' }; save(); render();
        }
        break;
      case 'toggle-template': {
        const s = ui.onboardRooms;
        s.has(el.dataset.key) ? s.delete(el.dataset.key) : s.add(el.dataset.key);
        render();
        break;
      }
      case 'onboard-add-member': ui.onboardMembers.push(''); render(); break;
      case 'onboard-next': ui.onboardStep = (ui.onboardStep || 1) + 1; render(); break;
      case 'onboard-finish': finishOnboarding(); break;
      case 'onboard-login': loginDialog('onboarding-finish'); break;
      case 'onboard-welcome-login': loginDialog('welcome'); break;
      case 'onboard-join': if (cloud.user) joinDialog(); else loginDialog('join'); break;
      case 'login': loginDialog('settings'); break;
      case 'logout': signOutAccount(); break;
      case 'delete-account': deleteAccount(); break;
      case 'rename-me': renameMe(); break;
      case 'household-menu': householdMenu(); break;
      case 'household-edit': {
        const h = activeHousehold();
        householdForm('Haushalt bearbeiten', h, async (name, icon) => {
          await Cloud.renameHousehold(activeId, name, icon);
          await refreshHouseholds();
        });
        break;
      }
      case 'household-leave': leaveHousehold(); break;
      case 'household-delete': deleteHousehold(); break;
      case 'invite': inviteDialog(); break;
      case 'remove-account': removeAccountMember(id); break;
      case 'dismiss-account-hint': state.settings.accountHintDismissed = true; save(); render(); break;
      default: break;
    }
  });

  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.dataset.memberName !== undefined) ui.onboardMembers[+t.dataset.memberName] = t.value;
    if (t.dataset.plantLocQ !== undefined) ui.locQuery = t.value;
    if (t.dataset.shopQ !== undefined) {
      // Nur die Vorschläge neu zeichnen – Fokus und Tastatur bleiben.
      ui.shopQuery = t.value;
      const box = document.querySelector('[data-shop-suggest]');
      if (box) box.innerHTML = shopSuggestions(t.value);
    }
    if (t.dataset.onboardMinutes !== undefined) {
      ui.onboardMinutes = +t.value;
      document.getElementById('min-val').textContent = t.value;
    }
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.budget !== undefined && t.dataset.budgetMember) {
      const m = member(t.dataset.budgetMember);
      if (m) {
        const today = S.today();
        if (!Array.isArray(m.minutesPerWeekday)) m.minutesPerWeekday = WEEKDAYS_SHORT.map((_, i) => S.memberBudget(Object.assign({}, m, { offDays: [] }), state.settings, today - S.weekday(today) + i));
        m.minutesPerWeekday[+t.dataset.budget] = Math.max(0, parseInt(t.value, 10) || 0);
        save();
        toast(`Zeit von ${m.name} gespeichert – der Plan wurde angepasst.`);
      }
    } else if (t.dataset.budget !== undefined) {
      state.settings.minutesPerWeekday[+t.dataset.budget] = Math.max(0, parseInt(t.value, 10) || 0);
      save();
      toast('Zeitbudget gespeichert – der Plan wurde angepasst.');
    }
    if (t.dataset.robot) setRobot(t.dataset.robot, t.checked);
    if (t.dataset.allergyToggle !== undefined) setAllergy({ enabled: t.checked });
    if (t.dataset.plantsInplan !== undefined) {
      plantsSettings().inPlan = t.checked;
      save();
      render();
      toast(t.checked ? 'Pflanzen zählen jetzt zum Putzplan 🪴' : 'Pflanzen stehen jetzt als eigener Block unter „Heute“');
    }
    if (t.dataset.onboardRobot) {
      ui.onboardRobot = ui.onboardRobot || {};
      ui.onboardRobot[t.dataset.onboardRobot] = t.checked;
    }
    if (t.dataset.reminderToggle !== undefined) {
      if (t.checked) enableReminder();
      else disableReminder();
    }
    if (t.dataset.reminderTime !== undefined && /^\d\d:\d\d$/.test(t.value)) {
      reminder().time = t.value;
      save();
      if (reminder().enabled && Native.isNative) {
        toast(`Erinnerung jetzt täglich um ${t.value} Uhr`);
      } else if (reminder().enabled) {
        withBusy(async () => {
          await registerReminder();
          toast(`Erinnerung jetzt täglich um ${t.value} Uhr`);
        });
      }
    }
  });

  // Katalog der Einkaufsliste: Kacheln erst beim Aufklappen einer Kategorie zeichnen.
  document.addEventListener('toggle', (ev) => {
    const d = ev.target;
    if (!d.dataset || d.dataset.shopCat === undefined) return;
    const open = ui.shopOpenCats || (ui.shopOpenCats = new Set());
    if (d.open === open.has(d.dataset.shopCat)) return;
    if (d.open) open.add(d.dataset.shopCat); else open.delete(d.dataset.shopCat);
    render();
  }, true);

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeModal();
    if (ev.key === 'Enter' && ev.target.dataset && ev.target.dataset.plantLocQ !== undefined) searchPlantLocation();
    if (ev.key === 'Enter' && ev.target.dataset && ev.target.dataset.shopQ !== undefined) {
      // Enter: genauer Katalog-Treffer, sonst als eigener Artikel.
      addFromQuery();
    }
  });

  // Plan neu berechnen, wenn die App nach Mitternacht wieder geöffnet wird.
  let lastRenderDay = S.today();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (S.today() !== lastRenderDay) {
      lastRenderDay = S.today();
      syncPlants();
      render();
    }
    refreshWeather(false);
    if (Native.isNative) {
      // Erinnerungen mit dem aktuellen Plan neu einplanen; Berechtigungen können sich geändert haben.
      Native.scheduleReminders(state, Shared, S);
      refreshNativeStatus();
      checkForUpdate(false);
    }
    scheduleSync(0);
  });

  window.addEventListener('online', () => scheduleSync(0));
  // Wer in der Ansicht getippt hat, bekommt fremde Änderungen, sobald das Feld verlassen wird.
  document.addEventListener('focusout', () => { if (pendingRender) setTimeout(softRender, 50); });

  /** Anmeldung beim Start wiederherstellen und auf Änderungen (Anmelden, Abmelden) hören. */
  async function startCloud() {
    if (!Cloud || !Cloud.available()) return;
    try {
      const s = await Cloud.session();
      cloud.user = s ? s.user : null;
    } catch (e) { cloud.user = null; }
    Cloud.onAuth((event, s) => {
      if (event === 'SIGNED_OUT') { if (cloud.user) clearCloudData(); return; }
      if (s && s.user) {
        const fresh = !cloud.user;
        cloud.user = s.user;
        // Rückkehr von der Google-Weiterleitung (Browser) oder neue Anmeldung.
        if (fresh && activeId === 'local') signedIn(s.user);
      }
    });
    if (!cloud.user) return;
    if (activeId === 'local') { signedIn(cloud.user); return; }
    refreshHouseholds().then(() => softRender());
    subscribeActive();
    scheduleSync(0);
    refreshMembers();
  }

  async function start() {
    migrate();
    // Ein Timer von gestern ist abgelaufen – offene Aufgaben sind heute ohnehin wieder fällig.
    if (state.session && state.session.day !== S.today()) state.session = null;
    if (Native.isNative) {
      // Falls localStorage leer ist (z. B. nach dem Löschen des Browser-Speichers), aus der Sicherung wiederherstellen.
      if (!state.onboarded) {
        const backup = await Native.loadBackup();
        if (backup && backup.onboarded) {
          state = Object.assign(defaultState(), backup);
          migrate();
        }
      }
      Native.onBackButton(() => {
        if (document.querySelector('#modal-root .modal')) closeModal();
        else if (ui.roomId) { ui.roomId = null; render(); }
        else if (ui.tab !== 'today' && state.onboarded) { ui.tab = 'today'; render(); }
        else Native.exitApp();
      });
      save();
      refreshNativeStatus();
      checkForUpdate(false);
    } else if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').then(resyncReminder).catch(() => {});
      syncToServiceWorker();
    }
    render();
    refreshWeather(false);
    startCloud();
  }

  start().catch(showError);
})();

/* Putzplan – App-Oberfläche und Datenhaltung (localStorage). */
(function () {
  'use strict';

  const S = window.Scheduler;
  const T = window.Templates;
  const Shared = window.PutzplanShared;
  const Native = window.PutzplanNative || { isNative: false };
  const STORAGE_KEY = 'putzplan.v1';
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
      history: [],
      settings: { minutesPerWeekday: [20, 20, 20, 20, 20, 60, 0] },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign(defaultState(), JSON.parse(raw));
    } catch (e) {
      console.warn('Konnte Daten nicht laden', e);
    }
    return defaultState();
  }

  let state = load();
  let ui = { tab: 'today', roomId: null, showMore: false };

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('Speichern fehlgeschlagen – ist der Speicher voll?');
    }
    syncToServiceWorker();
    if (Native.isNative) {
      Native.saveBackup(state);
      Native.scheduleReminders(state, Shared, S);
    }
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
    const today = S.today();
    if (t.snoozedUntil && t.snoozedUntil > today) return `Verschoben auf ${dayLabel(t.snoozedUntil)}`;
    const diff = S.dueDay(t) - today;
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
      id: uid(), taskId, day, memberId: memberId || (state.members[0] && state.members[0].id) || null,
      minutes: S.estimate(t), prevLastDone: t.lastDone, prevSnoozed: t.snoozedUntil || null,
    };
    if (o.actualMs !== undefined) {
      // Mit dem Timer gemessen: Dauer merken und daraus lernen.
      entry.session = true;
      entry.actualMinutes = Math.round((o.actualMs / MIN) * 10) / 10;
      entry.prevLearned = t.learnedMinutes || null;
      entry.prevDurations = t.durations ? t.durations.slice() : null;
      S.recordDuration(t, o.actualMs / MIN);
    }
    if (t.oneOff) {
      // Einmalige Aufgabe: nach dem Erledigen archivieren (bleibt für den Verlauf erhalten).
      entry.oneOff = true;
      t.archived = true;
      t.paused = true;
    }
    state.history.push(entry);
    t.lastDone = day;
    t.snoozedUntil = null;
    if (o.silent) return;
    save();
    render();
    toast(`„${t.name}“ erledigt 🎉`, { label: 'Rückgängig', run: () => undoEntry(entry.id) });
  }

  function skipTask(taskId) {
    const t = task(taskId);
    const entry = { id: uid(), taskId, day: S.today(), memberId: null, minutes: 0, skipped: true, prevLastDone: t.lastDone, prevSnoozed: t.snoozedUntil || null };
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
      if (h.oneOff) {
        t.archived = false;
        t.paused = false;
      }
      if (h.session) {
        t.learnedMinutes = h.prevLearned || undefined;
        t.durations = h.prevDurations || undefined;
      }
    }
    state.history.splice(idx, 1);
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
    const doneMin = state.history.filter((h) => h.day === today && !h.skipped).reduce((sum, h) => sum + h.minutes, 0);
    return Math.max(0, S.budgetFor(state.settings, today) - doneMin);
  }

  function startSessionDialog() {
    const today = S.today();
    const plan = S.planDays(state, today, 1, doneTodayIds())[0];
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
    const next = S.bonusCandidates(state, S.today(), s.taskIds.concat(doneTodayIds()), remainingMin + 1)[0];
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
      .filter((t) => !t.paused && !t.archived && !exclude.has(t.id) && !S.robotHandles(t, state.settings))
      .sort((a, b) => S.urgency(b, today) - S.urgency(a, today));
  }

  /**
   * Auswahl-Dialog mit Suchfeld. `compareTo`: beim Tauschen die bisherige Aufgabe,
   * damit dringendere Aufgaben markiert werden können.
   */
  function taskPicker({ title, intro, excludeIds, compareTo, extraButtons, onPick }) {
    const today = S.today();
    const all = pickCandidates(excludeIds);
    const refU = compareTo ? S.urgency(compareTo, today) : null;
    const row = (t) => {
      const r = room(t.roomId);
      const u = S.urgency(t, today);
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
    const open = sessionOpenIds(s).filter((id) => !extra.has(id));
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
      const moveCount = open.filter((id) => !extra.has(id)).length;
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
        const willMove = s.timeUp && !isDone && !extra.has(id);
        return `<li class="row ${isDone ? 'done' : ''}" data-action="session-toggle" data-id="${id}">
          <span class="check ${isDone ? 'checked' : ''}" aria-hidden="true">${isDone ? '✓' : ''}</span>
          <span class="room-icon">${r ? r.icon : '🧽'}</span>
          <div class="row-main">
            <div class="row-title">${esc(t.name)}</div>
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
    });
    return r;
  }

  // ---------------------------------------------------------------- Ansichten

  function viewToday() {
    const today = S.today();
    const plan = S.planDays(state, today, 1, doneTodayIds())[0];
    const doneEntries = state.history.filter((h) => h.day === today && !h.skipped);
    const plannedIds = new Set(plan.items.map((i) => i.task.id));
    const doneIds = new Set(doneEntries.map((h) => h.taskId));
    const extra = state.tasks
      .filter((t) => S.isPlannable(t, today, state.settings) && !plannedIds.has(t.id) && !doneIds.has(t.id) && S.urgency(t, today) >= 1)
      .sort((a, b) => S.urgency(b, today) - S.urgency(a, today));

    const doneMin = doneEntries.reduce((s, h) => s + h.minutes, 0);
    const openMin = plan.items.reduce((s, i) => s + S.estimate(i.task), 0);
    const total = doneMin + openMin;
    const pct = total ? Math.round((doneMin / total) * 100) : 100;
    const d = new Date();
    const hour = d.getHours();
    const greet = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';

    let html = `
      <header class="hero">
        <div>
          <p class="muted">${WEEKDAYS[S.weekday(today)]}, ${d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}</p>
          <h1>${greet}!</h1>
          <p class="muted">${plan.items.length ? `${plan.items.length} Aufgabe${plan.items.length === 1 ? '' : 'n'} · ca. ${fmtMinutes(openMin)}` : 'Für heute ist alles erledigt.'}</p>
        </div>
        <div class="ring" style="--p:${pct}"><span>${pct}%</span></div>
      </header>`;

    if (state.tasks.length) {
      html += `<button class="btn primary block timer-btn" data-action="session-start">⏱️ Putz-Timer starten</button>`;
    }

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

    if (plan.items.length) {
      html += `<section><h2>Heute zu tun</h2><ul class="list">${plan.items.map((i) => taskRow(i.task, i.memberId, i.early ? 'Vorgezogen' : null)).join('')}</ul></section>`;
    } else {
      html += `<div class="empty big"><div class="emoji">🎉</div><p><strong>Alles sauber!</strong><br>Genieß deinen Tag.</p></div>`;
    }

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
    const u = S.urgency(t, today);
    const overdue = S.dueDay(t) < today;
    return `<li class="row">
      <button class="check" data-action="complete" data-id="${t.id}" data-member="${memberId || ''}" title="Erledigt"></button>
      <span class="room-icon">${r ? r.icon : '🧽'}</span>
      <div class="row-main" data-action="task-menu" data-id="${t.id}" data-member="${memberId || ''}">
        <div class="row-title">${esc(t.name)}</div>
        <div class="row-sub">${r ? esc(r.name) : ''} · ${minutesLabel(t)}
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
      const tasks = state.tasks.filter((t) => t.roomId === r.id && !t.archived);
      const pct = S.roomCleanliness(tasks, today, state.settings);
      const due = tasks.filter((t) => S.isPlannable(t, today, state.settings) && S.urgency(t, today) >= 1).length;
      return `<button class="room-card" data-action="open-room" data-id="${r.id}">
        <span class="room-emoji">${r.icon}</span>
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
    const tasks = state.tasks.filter((t) => t.roomId === r.id && !t.archived)
      .sort((a, b) => S.dueDay(a) - S.dueDay(b));
    const pct = S.roomCleanliness(tasks, today, state.settings);
    return `
      <header class="page-head">
        <button class="link" data-action="close-room">‹ Alle Räume</button>
        <div class="room-title"><span class="room-emoji">${r.icon}</span><h1>${esc(r.name)}</h1>
          <button class="icon-btn" data-action="edit-room" data-id="${r.id}" title="Raum bearbeiten">✎</button></div>
        <div class="bar"><span style="width:${pct}%;background:${cleanlinessColor(pct)}"></span></div>
        <p class="muted">${pct}% sauber</p>
      </header>
      <ul class="list">${tasks.map((t) => {
        const u = S.urgency(t, today);
        if (S.robotHandles(t, state.settings)) {
          return `<li class="row robot">
          <span class="check robot-check" aria-hidden="true">🤖</span>
          <div class="row-main" data-action="edit-task" data-id="${t.id}">
            <div class="row-title">${esc(t.name)}</div>
            <div class="row-sub">Macht der ${t && S.floorType(t) === 'mop' ? 'Wischroboter' : 'Saugroboter'} – nicht im Putzplan</div>
          </div>
        </li>`;
        }
        const overdue = !t.paused && S.dueDay(t) <= today;
        return `<li class="row ${t.paused ? 'paused' : ''}">
          <button class="check" data-action="complete" data-id="${t.id}" data-member="${t.assignee || ''}" title="Jetzt erledigt"></button>
          <div class="row-main" data-action="edit-task" data-id="${t.id}">
            <div class="row-title">${esc(t.name)}</div>
            <div class="row-sub">${intervalLabel(t.interval)} · ${minutesLabel(t)} · <span class="${overdue ? 'bad-text' : ''}">${dueText(t)}</span></div>
            <div class="dirt"><span style="width:${Math.min(100, u * 100)}%;background:${dirtColor(u)}"></span></div>
          </div>
          ${avatar(member(t.assignee))}
        </li>`;
      }).join('')}</ul>
      <button class="btn primary block" data-action="add-task" data-room="${r.id}">＋ Aufgabe hinzufügen</button>`;
  }

  function streakDays() {
    const days = new Set(state.history.filter((h) => !h.skipped).map((h) => h.day));
    let d = S.today();
    if (!days.has(d)) d -= 1;
    let n = 0;
    while (days.has(d)) { n++; d--; }
    return n;
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
      <header class="page-head"><h1>Team & Statistik</h1></header>
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
      <header class="page-head"><h1>Einstellungen</h1></header>
      ${installCard()}
      ${reminderCard()}
      ${robotCard()}
      <section class="card">
        <h2>Zeitbudget pro Tag</h2>
        <p class="muted small">Wie viele Minuten möchtest du an welchem Tag putzen? Der Plan verteilt die Aufgaben automatisch. 0 = freier Tag.</p>
        <div class="budget-grid">${WEEKDAYS_SHORT.map((w, i) => `
          <label><span>${w}</span><input type="number" min="0" max="600" step="5" value="${b[i]}" data-budget="${i}"></label>`).join('')}</div>
      </section>
      <section class="card">
        <h2>Haushalt</h2>
        <ul class="list">${state.members.map((m) => `<li class="row" data-action="edit-member" data-id="${m.id}">${avatar(m, 'lg')}<div class="row-main"><div class="row-title">${esc(m.name)}</div>
          <div class="row-sub">${(m.offDays || []).length ? 'Frei: ' + m.offDays.map((d) => WEEKDAYS_SHORT[d]).join(', ') : 'Jeden Tag verfügbar'}</div></div><span class="muted">›</span></li>`).join('')}</ul>
        <button class="btn block" data-action="add-member">＋ Person hinzufügen</button>
      </section>
      <section class="card">
        <h2>Daten</h2>
        <p class="muted small">Alle Daten bleiben auf diesem Gerät. Exportiere sie als Backup oder um sie auf ein anderes Gerät zu übertragen.</p>
        <div class="btn-row">
          <button class="btn" data-action="export">⬇︎ Exportieren</button>
          <button class="btn" data-action="import">⬆︎ Importieren</button>
        </div>
        <button class="btn danger block" data-action="reset">Alles zurücksetzen</button>
      </section>
      <p class="muted small center">Putzplan · funktioniert offline · als App installierbar</p>`;
  }

  function viewOnboarding() {
    const step = ui.onboardStep || 1;
    if (step === 1) {
      const sel = ui.onboardRooms || new Set(['kitchen', 'bath', 'living', 'bedroom', 'hall', 'general']);
      ui.onboardRooms = sel;
      return `
        <div class="onboard">
          <div class="emoji big-emoji">🧹</div>
          <h1>Willkommen bei Putzplan</h1>
          <p class="muted">Welche Räume hat dein Zuhause? Wir legen passende Aufgaben mit sinnvollen Intervallen an – anpassen kannst du alles später.</p>
          <div class="chip-grid">${T.ROOM_TEMPLATES.map((r) => `
            <button class="chip ${sel.has(r.key) ? 'on' : ''}" data-action="toggle-template" data-key="${r.key}">${r.icon} ${r.name}</button>`).join('')}</div>
          <button class="btn primary block" data-action="onboard-next" ${sel.size ? '' : 'disabled'}>Weiter</button>
        </div>`;
    }
    if (step === 2) {
      const names = ui.onboardMembers || [''];
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
        <button class="btn primary block" data-action="onboard-finish">Putzplan erstellen ✨</button>
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
      <p class="muted">${dueText(t)} · ${intervalLabel(t.interval)}</p>
      <div class="menu">
        <button data-m="done">✅ Erledigt${member(memberId) ? ` (${esc(member(memberId).name)})` : ''}</button>
        ${others.map((m) => `<button data-m="done-by" data-member="${m.id}">✅ Erledigt von ${esc(m.name)}</button>`).join('')}
        <button data-m="snooze1">⏰ Auf morgen verschieben</button>
        <button data-m="snooze3">⏰ Um 3 Tage verschieben</button>
        <button data-m="skip">⏭️ Diesmal überspringen</button>
        <button data-m="edit">✎ Bearbeiten</button>
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
        };
      });
    });
  }

  function editTask(taskId, roomId) {
    const t = taskId ? task(taskId) : { name: '', interval: 7, minutes: 10, roomId, assignee: null, paused: false };
    const presetMatch = T.INTERVALS.some(([d]) => d === t.interval);
    openModal(`
      <h2>${taskId ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}</h2>
      <form id="task-form" class="form">
        <label>Was ist zu tun?<input class="input" name="name" required value="${esc(t.name)}" placeholder="z. B. Fenster putzen"></label>
        <label>Raum<select class="input" name="roomId">${state.rooms.map((r) => `<option value="${r.id}" ${r.id === t.roomId ? 'selected' : ''}>${r.icon} ${esc(r.name)}</option>`).join('')}</select></label>
        <label>Wie oft?<select class="input" name="intervalPreset">
          ${T.INTERVALS.map(([d, l]) => `<option value="${d}" ${d === t.interval ? 'selected' : ''}>${l}</option>`).join('')}
          <option value="custom" ${presetMatch ? '' : 'selected'}>Eigenes Intervall…</option></select></label>
        <label class="custom-interval" ${presetMatch ? 'hidden' : ''}>Alle … Tage<input class="input" type="number" min="1" max="730" name="interval" value="${t.interval}"></label>
        <label>Dauer (Minuten)<input class="input" type="number" min="1" max="480" name="minutes" value="${t.minutes}"></label>
        ${t.learnedMinutes ? `<p class="small learned">⏱ Gelernt aus ${t.durations.length} Messung${t.durations.length === 1 ? '' : 'en'}: du brauchst ca. <strong>${fmtMinutes(t.learnedMinutes)}</strong>.
          Der Plan rechnet damit. Änderst du die Dauer oben, wird neu gelernt.</p>` : ''}
        ${robotEnabled() ? `<label>Bodenreinigung<select class="input" name="floor">
          ${[['', 'Keine Bodenaufgabe'], ['vacuum', 'Staubsaugen (Saugroboter)'], ['mop', 'Boden wischen (Wischroboter)']]
            .map(([v, l]) => `<option value="${v}" ${S.floorType(t) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
        ${state.members.length ? `<label>Zuständig<select class="input" name="assignee">${memberOptions(t.assignee, 'Automatisch verteilen')}</select></label>` : ''}
        ${taskId ? `<label class="check-label"><input type="checkbox" name="paused" ${t.paused ? 'checked' : ''}> Pausieren (z. B. im Urlaub)</label>` : `
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
        el.querySelector('.custom-interval').hidden = form.intervalPreset.value !== 'custom';
      };
      el.querySelector('[data-cancel]').onclick = closeModal;
      const del = el.querySelector('[data-del]');
      if (del) del.onclick = () => {
        if (!confirm(`„${t.name}“ wirklich löschen?`)) return;
        state.tasks = state.tasks.filter((x) => x.id !== taskId);
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
        if (taskId) {
          if (data.minutes !== t.minutes) { delete t.learnedMinutes; delete t.durations; }
          Object.assign(t, data, { paused: form.paused.checked });
        } else {
          const today = S.today();
          const last = form.last.value === '0' ? today : form.last.value === 'due' ? today - data.interval : today - Math.ceil(data.interval / 2);
          state.tasks.push(Object.assign({ id: uid(), lastDone: last, paused: false, snoozedUntil: null }, data));
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
        ui.roomId = null;
        save(); closeModal(); render();
      };
      el.querySelector('form').onsubmit = (ev) => {
        ev.preventDefault();
        const name = ev.target.name.value.trim();
        if (!name) return;
        if (roomId) Object.assign(r, { name, icon });
        else { const nr = { id: uid(), name, icon }; state.rooms.push(nr); ui.roomId = nr.id; }
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
        state = Object.assign(defaultState(), data);
        save(); render();
        toast('Daten importiert ✅');
      } catch (e) {
        toast('Die Datei konnte nicht gelesen werden.');
      }
    };
    input.click();
  }

  // ---------------------------------------------------------------- Rendering & Events

  function render() {
    const view = document.getElementById('view');
    const tabs = document.getElementById('tabs');
    if (!state.onboarded) {
      tabs.hidden = true;
      view.innerHTML = viewOnboarding();
      return;
    }
    tabs.hidden = false;
    tabs.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
    const views = { today: viewToday, week: viewWeek, rooms: viewRooms, team: viewTeam, settings: viewSettings };
    if (state.session && ui.tab === 'today') views.today = viewSession;
    view.innerHTML = views[ui.tab]();
    ensureSessionTimer();
  }

  function finishOnboarding() {
    const keys = ui.onboardRooms;
    T.ROOM_TEMPLATES.filter((r) => keys.has(r.key)).forEach((r) => addRoomFromTemplate(r, true));
    (ui.onboardMembers || []).map((n) => n.trim()).filter(Boolean).forEach((name, i) => {
      state.members.push({ id: uid(), name, color: T.MEMBER_COLORS[i % T.MEMBER_COLORS.length], offDays: [] });
    });
    const m = ui.onboardMinutes || 20;
    state.settings.minutesPerWeekday = [m, m, m, m, m, m * 3, 0];
    const rb = ui.onboardRobot || {};
    state.settings.robot = { vacuum: !!rb.vacuum, mop: !!rb.mop, excludedRooms: [] };
    syncRobotTasks();
    state.onboarded = true;
    ui = { tab: 'today', roomId: null, showMore: false };
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
      case 'import': importData(); break;
      case 'install':
        if (installPrompt) {
          installPrompt.prompt();
          installPrompt.userChoice.finally(() => { installPrompt = null; render(); });
        }
        break;
      case 'dismiss-install': state.settings.installHintDismissed = true; save(); render(); break;
      case 'robot-room': toggleRobotRoom(id); break;
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
      default: break;
    }
  });

  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.dataset.memberName !== undefined) ui.onboardMembers[+t.dataset.memberName] = t.value;
    if (t.dataset.onboardMinutes !== undefined) {
      ui.onboardMinutes = +t.value;
      document.getElementById('min-val').textContent = t.value;
    }
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.budget !== undefined) {
      state.settings.minutesPerWeekday[+t.dataset.budget] = Math.max(0, parseInt(t.value, 10) || 0);
      save();
      toast('Zeitbudget gespeichert – der Plan wurde angepasst.');
    }
    if (t.dataset.robot) setRobot(t.dataset.robot, t.checked);
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

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeModal();
  });

  // Plan neu berechnen, wenn die App nach Mitternacht wieder geöffnet wird.
  let lastRenderDay = S.today();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (S.today() !== lastRenderDay) {
      lastRenderDay = S.today();
      render();
    }
    if (Native.isNative) {
      // Erinnerungen mit dem aktuellen Plan neu einplanen; Berechtigungen können sich geändert haben.
      Native.scheduleReminders(state, Shared, S);
      refreshNativeStatus();
    }
  });

  async function start() {
    // Ein Timer von gestern ist abgelaufen – offene Aufgaben sind heute ohnehin wieder fällig.
    if (state.session && state.session.day !== S.today()) state.session = null;
    if (Native.isNative) {
      // Falls localStorage leer ist (z. B. nach dem Löschen des Browser-Speichers), aus der Sicherung wiederherstellen.
      if (!state.onboarded) {
        const backup = await Native.loadBackup();
        if (backup && backup.onboarded) state = Object.assign(defaultState(), backup);
      }
      Native.onBackButton(() => {
        if (document.querySelector('#modal-root .modal')) closeModal();
        else if (ui.roomId) { ui.roomId = null; render(); }
        else if (ui.tab !== 'today' && state.onboarded) { ui.tab = 'today'; render(); }
        else Native.exitApp();
      });
      save();
      refreshNativeStatus();
    } else if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').then(resyncReminder).catch(() => {});
      syncToServiceWorker();
    }
    render();
  }

  start();
})();

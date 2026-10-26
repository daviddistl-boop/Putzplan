/*
 * Putzplan – Anbindung an die Android-App (Capacitor).
 *
 * Im Browser ist `PutzplanNative.isNative` false und nichts hiervon wird benutzt.
 * In der Android-App:
 *  - Sicherungskopie der Daten als Datei im privaten App-Speicher (zusätzlich zu localStorage)
 *  - tägliche Erinnerungen als lokale Benachrichtigungen – ganz ohne Server
 *  - Export über das Android-Teilen-Menü, Zurück-Taste
 */
(function (root) {
  'use strict';

  const Cap = root.Capacitor;
  const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const P = (isNative && Cap.Plugins) || {};

  const BACKUP_FILE = 'putzplan-daten.json';
  const CHANNEL = 'erinnerungen';
  const FIRST_ID = 1000;
  // So viele Tage im Voraus werden Erinnerungen eingeplant. Bei jedem Öffnen
  // der App wird neu geplant, damit Inhalt und Zeitraum aktuell bleiben.
  const DAYS_AHEAD = 30;
  const TEST_ID = 999;
  const TIMER_ID = 998;

  // ------------------------------------------------------------ Datensicherung

  let backupTimer = null;
  function saveBackup(state) {
    if (!isNative) return;
    clearTimeout(backupTimer);
    backupTimer = setTimeout(() => {
      P.Filesystem.writeFile({ path: BACKUP_FILE, directory: 'DATA', encoding: 'utf8', data: JSON.stringify(state) })
        .catch((e) => console.warn('Sicherung fehlgeschlagen', e));
    }, 300);
  }

  async function loadBackup() {
    if (!isNative) return null;
    try {
      const res = await P.Filesystem.readFile({ path: BACKUP_FILE, directory: 'DATA', encoding: 'utf8' });
      return JSON.parse(res.data);
    } catch (e) {
      return null; // noch keine Sicherung vorhanden
    }
  }

  // ------------------------------------------------------------ Erinnerungen

  let channelReady = null;
  function ensureChannel() {
    if (!channelReady) {
      channelReady = P.LocalNotifications.createChannel({
        id: CHANNEL, name: 'Tägliche Erinnerung', description: 'Was heute geputzt werden soll', importance: 4, visibility: 1,
      }).catch(() => {});
    }
    return channelReady;
  }

  async function notificationPermission(ask) {
    const res = ask ? await P.LocalNotifications.requestPermissions() : await P.LocalNotifications.checkPermissions();
    return res.display;
  }

  /** 'granted' | 'denied' | null (Android < 12 braucht keine Erlaubnis). */
  async function exactAlarmStatus() {
    try {
      const res = await P.LocalNotifications.checkExactNotificationSetting();
      return res.exact_alarm;
    } catch (e) {
      return null;
    }
  }

  function openExactAlarmSettings() {
    return P.LocalNotifications.changeExactNotificationSetting().catch(() => {});
  }

  async function cancelAll() {
    const pending = await P.LocalNotifications.getPending();
    const ids = pending.notifications.filter((n) => n.id >= FIRST_ID).map((n) => ({ id: n.id }));
    if (ids.length) await P.LocalNotifications.cancel({ notifications: ids });
  }

  let scheduling = Promise.resolve();
  let scheduleTimer = null;

  /** Plant die Erinnerungen der nächsten Tage neu (oder löscht sie, wenn ausgeschaltet). */
  function scheduleReminders(state, Shared, S) {
    if (!isNative) return Promise.resolve();
    clearTimeout(scheduleTimer);
    return new Promise((resolve) => {
      scheduleTimer = setTimeout(() => {
        scheduling = scheduling.then(() => doSchedule(state, Shared, S)).catch((e) => console.warn('Planen fehlgeschlagen', e)).then(resolve);
      }, 400);
    });
  }

  async function doSchedule(state, Shared, S) {
    await cancelAll();
    const r = state.settings && state.settings.reminder;
    if (!state.onboarded || !r || !r.enabled) return;
    if ((await notificationPermission(false)) !== 'granted') return;
    await ensureChannel();
    // Ohne Erlaubnis für exakte Wecker ungenau planen – sonst öffnet das Plugin
    // bei jedem Planen die Android-Einstellungen.
    const exact = (await exactAlarmStatus()) !== 'denied';

    const [hh, mm] = r.time.split(':').map(Number);
    const now = Date.now();
    const notifications = Shared.reminderMessages(state, S, DAYS_AHEAD)
      .map((msg, i) => {
        const d = S.dayToDate(msg.day);
        const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0);
        return { msg, at, id: FIRST_ID + i };
      })
      .filter((n) => n.at.getTime() > now + 30000)
      .map(({ msg, at, id }) => ({
        id,
        title: msg.title,
        body: msg.body.split('\n').join(' · '),
        largeBody: msg.body,
        channelId: CHANNEL,
        schedule: { at, allowWhileIdle: true },
        isExactNotification: exact,
      }));
    if (notifications.length) await P.LocalNotifications.schedule({ notifications });
  }

  async function testNotification(state, Shared, S) {
    await ensureChannel();
    const msg = Shared.reminderMessage(state, S);
    await P.LocalNotifications.schedule({
      notifications: [{
        id: TEST_ID, title: '🔔 Test · ' + msg.title, body: msg.body.split('\n').join(' · '), largeBody: msg.body,
        channelId: CHANNEL, schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true },
        isExactNotification: (await exactAlarmStatus()) !== 'denied',
      }],
    });
  }

  // ------------------------------------------------------------ Putz-Timer

  /** Benachrichtigung, wenn die Timer-Zeit abgelaufen ist (auch bei gesperrtem Bildschirm). */
  async function scheduleTimerEnd(at, openCount) {
    if (!isNative) return;
    try {
      await cancelTimerEnd();
      if ((await notificationPermission(false)) !== 'granted') return;
      await ensureChannel();
      await P.LocalNotifications.schedule({
        notifications: [{
          id: TIMER_ID,
          title: '⏰ Putz-Zeit ist um!',
          body: openCount ? 'Hake ab, was du geschafft hast – der Rest wandert auf morgen.' : 'Super gemacht! 🎉',
          channelId: CHANNEL,
          schedule: { at, allowWhileIdle: true },
          isExactNotification: (await exactAlarmStatus()) !== 'denied',
        }],
      });
    } catch (e) {
      console.warn('Timer-Benachrichtigung fehlgeschlagen', e);
    }
  }

  function cancelTimerEnd() {
    if (!isNative) return Promise.resolve();
    return P.LocalNotifications.cancel({ notifications: [{ id: TIMER_ID }] }).catch(() => {});
  }

  // ------------------------------------------------------------ Export & Zurück-Taste

  async function shareExport(filename, json) {
    const file = await P.Filesystem.writeFile({ path: filename, directory: 'CACHE', encoding: 'utf8', data: json });
    await P.Share.share({ title: 'Putzplan-Sicherung', files: [file.uri], dialogTitle: 'Sicherung speichern oder senden' });
  }

  function onBackButton(handler) {
    if (isNative && P.App) P.App.addListener('backButton', handler);
  }

  function exitApp() {
    if (isNative && P.App) P.App.exitApp();
  }

  root.PutzplanNative = {
    isNative,
    saveBackup,
    loadBackup,
    notificationPermission,
    exactAlarmStatus,
    openExactAlarmSettings,
    scheduleReminders,
    testNotification,
    scheduleTimerEnd,
    cancelTimerEnd,
    shareExport,
    onBackButton,
    exitApp,
  };
})(typeof window !== 'undefined' ? window : globalThis);

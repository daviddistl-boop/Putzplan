const test = require('node:test');
const assert = require('node:assert');
const S = require('../scheduler.js');

const MONDAY = S.dateToDay(new Date(2026, 9, 12)); // Mo, 12.10.2026

function mkTask(id, interval, minutes, lastDone, extra) {
  return Object.assign({ id, roomId: 'r', name: id, interval, minutes, lastDone, assignee: null, paused: false, snoozedUntil: null }, extra);
}

function state(tasks, extra) {
  return Object.assign({ tasks, members: [], settings: { minutesPerWeekday: [30, 30, 30, 30, 30, 60, 0] } }, extra);
}

test('weekday: Montag = 0, Sonntag = 6', () => {
  assert.strictEqual(S.weekday(MONDAY), 0);
  assert.strictEqual(S.weekday(MONDAY + 6), 6);
});

test('dateToDay und dayToDate sind umkehrbar', () => {
  const d = S.dayToDate(MONDAY);
  assert.strictEqual(d.getDate(), 12);
  assert.strictEqual(S.dateToDay(d), MONDAY);
});

test('urgency: 0 nach dem Putzen, 1 bei Fälligkeit', () => {
  const t = mkTask('a', 7, 10, MONDAY);
  assert.strictEqual(S.urgency(t, MONDAY), 0);
  assert.strictEqual(S.urgency(t, MONDAY + 7), 1);
  assert.strictEqual(S.urgency(t, MONDAY + 14), 2);
});

test('fällige Aufgaben werden nach Dringlichkeit geplant', () => {
  const tasks = [mkTask('a', 7, 10, MONDAY - 7), mkTask('b', 7, 10, MONDAY - 14), mkTask('c', 7, 10, MONDAY - 1)];
  const [day] = S.planDays(state(tasks), MONDAY, 1);
  assert.deepStrictEqual(day.items.map((i) => i.task.id), ['b', 'a']);
});

test('Zeitbudget wird eingehalten, Rest rutscht auf den nächsten Tag', () => {
  const tasks = [mkTask('a', 7, 20, MONDAY - 9), mkTask('b', 7, 20, MONDAY - 8)];
  const plan = S.planDays(state(tasks), MONDAY, 2);
  assert.deepStrictEqual(plan[0].items.map((i) => i.task.id), ['a']);
  assert.deepStrictEqual(plan[1].items.map((i) => i.task.id), ['b']);
});

test('freier Tag (Budget 0) bleibt leer', () => {
  const sunday = MONDAY + 6;
  const tasks = [mkTask('a', 1, 10, sunday - 3), mkTask('b', 7, 10, sunday - 10)];
  const [day] = S.planDays(state(tasks), sunday, 1);
  assert.strictEqual(day.items.length, 0);
});

test('bald fällige Aufgaben werden bei freier Zeit vorgezogen', () => {
  const tasks = [mkTask('a', 10, 10, MONDAY - 9)]; // 90 % verschmutzt
  const [day] = S.planDays(state(tasks), MONDAY, 1);
  assert.strictEqual(day.items.length, 1);
  assert.strictEqual(day.items[0].early, true);
});

test('wiederkehrende Aufgaben tauchen im Wochenplan erneut auf', () => {
  const tasks = [mkTask('a', 2, 5, MONDAY - 2)];
  const plan = S.planDays(state(tasks), MONDAY, 6);
  const days = plan.filter((d) => d.items.length).map((d) => d.day - MONDAY);
  assert.deepStrictEqual(days, [0, 2, 4]);
});

test('verschobene und pausierte Aufgaben werden ausgelassen', () => {
  const tasks = [
    mkTask('a', 7, 10, MONDAY - 10, { snoozedUntil: MONDAY + 1 }),
    mkTask('b', 7, 10, MONDAY - 10, { paused: true }),
  ];
  const plan = S.planDays(state(tasks), MONDAY, 2);
  assert.strictEqual(plan[0].items.length, 0);
  assert.deepStrictEqual(plan[1].items.map((i) => i.task.id), ['a']);
});

test('heute erledigte Aufgaben verbrauchen Budget und werden nicht erneut geplant', () => {
  const tasks = [mkTask('a', 7, 25, MONDAY), mkTask('b', 7, 10, MONDAY - 8)];
  const [day] = S.planDays(state(tasks), MONDAY, 1, ['a']);
  assert.strictEqual(day.budget, 5);
  // b ist größer als das Restbudget, wird aber als einzige Aufgabe trotzdem eingeplant.
  assert.deepStrictEqual(day.items.map((i) => i.task.id), ['b']);
});

test('Aufgaben werden fair auf Mitglieder verteilt', () => {
  const tasks = [mkTask('a', 7, 10, MONDAY - 9), mkTask('b', 7, 10, MONDAY - 8), mkTask('c', 7, 10, MONDAY - 7)];
  const members = [{ id: 'm1' }, { id: 'm2' }];
  const [day] = S.planDays(state(tasks, { members }), MONDAY, 1);
  const counts = day.items.reduce((acc, i) => ((acc[i.memberId] = (acc[i.memberId] || 0) + 1), acc), {});
  assert.deepStrictEqual(counts, { m1: 2, m2: 1 });
});

test('feste Zuständigkeit und freie Tage werden beachtet', () => {
  const tasks = [mkTask('a', 7, 10, MONDAY - 9, { assignee: 'm2' }), mkTask('b', 7, 10, MONDAY - 8)];
  const members = [{ id: 'm1', offDays: [] }, { id: 'm2', offDays: [0] }];
  const [day] = S.planDays(state(tasks, { members }), MONDAY, 1);
  const byTask = Object.fromEntries(day.items.map((i) => [i.task.id, i.memberId]));
  assert.deepStrictEqual(byTask, { a: 'm2', b: 'm1' });
});

test('roomCleanliness', () => {
  const tasks = [mkTask('a', 10, 5, MONDAY), mkTask('b', 10, 5, MONDAY - 20)];
  assert.strictEqual(S.roomCleanliness(tasks, MONDAY), 50);
  assert.strictEqual(S.roomCleanliness([], MONDAY), 100);
});

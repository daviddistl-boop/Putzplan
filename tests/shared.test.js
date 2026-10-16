const test = require('node:test');
const assert = require('node:assert');
const S = require('../scheduler.js');
require('../shared.js');
const { reminderMessage } = globalThis.PutzplanShared;

const today = S.today();
const settings = { minutesPerWeekday: [60, 60, 60, 60, 60, 60, 60] };
const rooms = [{ id: 'k', name: 'Küche', icon: '🍳' }];
const mk = (id, name, lastDone) => ({ id, roomId: 'k', name, interval: 7, minutes: 10, lastDone });

test('Erinnerung listet die heutigen Aufgaben', () => {
  const state = { rooms, settings, members: [], history: [], tasks: [mk('a', 'Herd reinigen', today - 8), mk('b', 'Boden wischen', today - 7)] };
  const msg = reminderMessage(state, S);
  assert.strictEqual(msg.title, 'Heute: 2 Aufgaben · ca. 20 Min.');
  assert.strictEqual(msg.body, '🍳 Herd reinigen\n🍳 Boden wischen');
});

test('Erinnerung kürzt lange Listen ab', () => {
  const tasks = [1, 2, 3, 4, 5, 6].map((i) => mk(String(i), `Aufgabe ${i}`, today - 7 - i));
  const msg = reminderMessage({ rooms, settings, members: [], history: [], tasks }, S);
  assert.match(msg.body, /… und 2 weitere$/);
});

test('Erinnerung bei leerem Plan', () => {
  const state = { rooms, settings, members: [], history: [], tasks: [mk('a', 'Herd', today)] };
  assert.strictEqual(reminderMessage(state, S).title, 'Alles sauber ✨');
});

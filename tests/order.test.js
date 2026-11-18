const test = require('node:test');
const assert = require('node:assert');
const S = require('../scheduler.js');
const T = require('../templates.js');

const step = (name) => S.CLEAN_STEPS[S.cleanStep(name)].key;

test('Schritte: aufräumen vor putzen, oben vor unten, trocken vor nass', () => {
  assert.strictEqual(step('Wäsche waschen & aufhängen'), 'start');
  assert.strictEqual(step('Bettwäsche wechseln'), 'start');
  assert.strictEqual(step('Aufräumen'), 'tidy');
  assert.strictEqual(step('Tisch abräumen'), 'tidy');
  assert.strictEqual(step('Geschirr spülen / Spülmaschine'), 'dishes');
  assert.strictEqual(step('Staub wischen'), 'dust');
  assert.strictEqual(step('Spiegel putzen'), 'dust');
  assert.strictEqual(step('Arbeitsflächen abwischen'), 'surfaces');
  assert.strictEqual(step('Tisch abwischen'), 'surfaces');
  assert.strictEqual(step('Toilette putzen'), 'surfaces');
  assert.strictEqual(step('Staubsaugen'), 'floor');
  assert.strictEqual(step('Boden wischen'), 'mop');
  assert.strictEqual(step('Müll rausbringen'), 'finish');
  assert.strictEqual(step('Handtücher wechseln'), 'finish');
  assert.strictEqual(step('Wäsche zusammenlegen & wegräumen'), 'finish');
  assert.strictEqual(step('Irgendwas Neues'), 'surfaces');
  assert.strictEqual(step('Kühlschrank auswischen'), 'surfaces');
  assert.strictEqual(step('Sofa absaugen'), 'surfaces');
  assert.strictEqual(step('Getragene Kleidung aus dem Schlafzimmer räumen'), 'tidy');
  assert.strictEqual(step('Pflanzen düngen'), 'finish');
  assert.strictEqual(step('Schränke auswischen'), 'dust');
});

test('Alle Vorlagen-Aufgaben bekommen einen sinnvollen Schritt', () => {
  for (const r of T.ROOM_TEMPLATES) for (const [name] of r.tasks) assert.ok(S.cleanStep(name) >= 0, name);
  const kitchen = T.ROOM_TEMPLATES.find((r) => r.key === 'kitchen').tasks.map(([n]) => ({ name: n, roomId: 'k' }));
  const order = S.cleaningOrder(kitchen, [{ id: 'k' }])[0].tasks.map((x) => x.task.name);
  assert.ok(order.indexOf('Geschirr spülen / Spülmaschine') < order.indexOf('Arbeitsflächen abwischen'));
  assert.ok(order.indexOf('Arbeitsflächen abwischen') < order.indexOf('Boden wischen'));
  assert.ok(order.indexOf('Schränke auswischen') < order.indexOf('Herd reinigen'));
  assert.strictEqual(order[order.length - 1], 'Müll rausbringen');
});

test('Reihenfolge: Laufenlassen zuerst, dann Raum für Raum in Raum-Reihenfolge', () => {
  const tasks = [
    { id: 1, name: 'Boden wischen', roomId: 'k' },
    { id: 2, name: 'Staubsaugen', roomId: 'w' },
    { id: 3, name: 'Wäsche waschen & aufhängen', roomId: 'l' },
    { id: 4, name: 'Aufräumen', roomId: 'w' },
    { id: 5, name: 'Geschirr spülen / Spülmaschine', roomId: 'k' },
    { id: 6, name: 'Arbeitsflächen abwischen', roomId: 'k' },
  ];
  const g = S.cleaningOrder(tasks, [{ id: 'w' }, { id: 'k' }, { id: 'l' }]);
  assert.deepStrictEqual(g.map((x) => x.roomId), [null, 'w', 'k']);
  assert.deepStrictEqual(g.map((x) => x.tasks.map((t) => t.task.id)), [[3], [4, 2], [5, 6, 1]]);
});

test('„Erst nach“: im Raum direkt hinter die Vorgängerin, über Räume hinweg Raum zuerst', () => {
  const tasks = [
    { id: 'a', name: 'Tisch abwischen', roomId: 'w' },
    { id: 'b', name: 'Tisch abräumen', roomId: 'w' },
    { id: 'c', name: 'Staubsaugen', roomId: 'w' },
    { id: 'd', name: 'Arbeitsflächen abwischen', roomId: 'k', after: 'c' }, // Küche erst nach dem Saugen im Wohnzimmer
    { id: 'e', name: 'Spiegel putzen', roomId: 'w', after: 'a' }, // Spiegel erst nach dem Tisch (Staub-Schritt käme sonst vorher)
  ];
  const g = S.cleaningOrder(tasks, [{ id: 'k' }, { id: 'w' }]);
  assert.deepStrictEqual(g.map((x) => x.roomId), ['w', 'k']);
  assert.deepStrictEqual(g[0].tasks.map((x) => x.task.id), ['b', 'a', 'e', 'c']);
  // Kreis bricht sicher ab
  const loop = S.cleaningOrder([{ id: 1, name: 'A', roomId: 'r', after: 2 }, { id: 2, name: 'B', roomId: 'r', after: 1 }], []);
  assert.strictEqual(loop[0].tasks.length, 2);
});

test('Wichtigkeit: „Muss“ kommt trotz vollem Budget in den Plan, „Kann warten“ nur bei freier Zeit', () => {
  const day = 20000;
  const t = (id, name, minutes, priority) => ({ id, roomId: 'r', name, interval: 7, minutes, lastDone: day - 10, priority });
  const state = {
    rooms: [{ id: 'r', name: 'R' }], members: [], history: [],
    tasks: [t('n1', 'Normal', 15), t('m', 'Muss', 10, 'must'), t('o', 'Kann', 10, 'optional'), t('m2', 'Muss 2', 20, 'must')],
    settings: { minutesPerWeekday: [30, 30, 30, 30, 30, 30, 30] },
  };
  const ids = S.planDays(state, day, 1)[0].items.map((i) => i.task.id);
  assert.ok(ids.includes('m') && ids.includes('m2'), 'Muss ist dabei, auch über das Budget');
  assert.deepStrictEqual(ids.slice(0, 2).sort(), ['m', 'm2']);
  assert.ok(!ids.includes('o'), 'Kann warten fällt raus, weil das Budget voll ist');
  state.settings.minutesPerWeekday = [60, 60, 60, 60, 60, 60, 60];
  assert.ok(S.planDays(state, day, 1)[0].items.some((i) => i.task.id === 'o'));
  assert.strictEqual(S.priorityOf({ priority: 'must' }).short, 'Muss');
  assert.strictEqual(S.priorityOf({}).key, 'normal');
});

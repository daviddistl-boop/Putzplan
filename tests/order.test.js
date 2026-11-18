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

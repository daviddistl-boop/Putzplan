const test = require('node:test');
const assert = require('node:assert');
const Sync = require('../sync.js');

function sampleState() {
  return {
    version: 1,
    onboarded: true,
    rooms: [{ id: 'r2', name: 'Küche', icon: '🍳' }, { id: 'r1', name: 'Bad', icon: '🛁' }],
    tasks: [
      { id: 't1', roomId: 'r1', name: 'Toilette', interval: 7, minutes: 10, lastDone: 100 },
      { id: 'p1-water', roomId: 'r2', plantId: 'p1', plantCare: 'water', name: '💧 Monstera gießen', dueOn: 105, interval: 7, note: '', minutes: 2 },
    ],
    members: [{ id: 'm1', name: 'Anna', color: '#f00', offDays: [] }],
    plants: [{ id: 'p1', name: 'Monstera', species: 'monstera', roomId: 'r2' }],
    history: [{ id: 'h1', taskId: 't1', day: 100, minutes: 10, at: 1 }],
    settings: { minutesPerWeekday: [20, 20, 20, 20, 20, 60, 0], reminder: { enabled: true, time: '08:00' }, plants: { inPlan: false, location: { name: 'München' } } },
    session: { day: 100 },
  };
}

test('Zustand → Datensätze → Zustand: Reihenfolge, Inhalte und Persönliches bleiben erhalten', () => {
  const st = sampleState();
  const docs = Sync.stateToDocs(st);
  assert.ok(docs.has('room:r2') && docs.has('task:t1') && docs.has('settings:main') && docs.has('history:h1'));
  // Persönliches geht nicht in die gemeinsamen Einstellungen.
  const shared = JSON.parse(docs.get('settings:main'));
  assert.strictEqual(shared.reminder, undefined);
  assert.strictEqual(shared.plants.inPlan, undefined);
  assert.strictEqual(shared.plants.location.name, 'München');
  // Berechnete Werte der Pflanzenaufgaben werden nicht abgeglichen.
  const pt = JSON.parse(docs.get('task:p1-water'));
  assert.strictEqual(pt.dueOn, undefined);
  assert.strictEqual(pt.name, undefined);

  const back = Sync.docsToState(docs, st);
  assert.deepStrictEqual(back.rooms.map((r) => r.id), ['r2', 'r1']);
  assert.strictEqual(back.rooms[0]._o, undefined);
  assert.deepStrictEqual(back.settings.reminder, { enabled: true, time: '08:00' });
  assert.strictEqual(back.settings.plants.inPlan, false);
  assert.strictEqual(back.session.day, 100);
  assert.strictEqual(back.tasks.find((t) => t.id === 'p1-water').dueOn, 105);
});

test('diff: nur Geändertes wird hochgeladen, Gelöschtes als Grabstein', () => {
  const st = sampleState();
  const docs = Sync.stateToDocs(st);
  const shadow = Object.fromEntries(docs);
  assert.deepStrictEqual(Sync.diff(shadow, docs), { upserts: [], deletes: [] });
  st.tasks[0].lastDone = 107;
  st.members = [];
  const d = Sync.diff(shadow, Sync.stateToDocs(st));
  assert.deepStrictEqual(d.upserts.map((u) => u.key), ['task:t1']);
  assert.deepStrictEqual(d.deletes.map((x) => x.key), ['member:m1']);
  const rows = Sync.toRows(d);
  assert.deepStrictEqual(rows.map((r) => [r.kind, r.id, r.deleted]), [['task', 't1', false], ['member', 'm1', true]]);
  assert.strictEqual(rows[0].data.lastDone, 107);
});

test('applyRemote: fremde Änderungen werden übernommen, eigene offene Änderungen bleiben', () => {
  const st = sampleState();
  const docs = Sync.stateToDocs(st);
  const shadow = Object.fromEntries(docs);
  // Lokal noch nicht hochgeladen: Raum umbenannt.
  st.rooms[0].name = 'Wohnküche';
  const local = Sync.stateToDocs(st);
  const rows = [
    { kind: 'room', id: 'r2', data: { id: 'r2', name: 'Küche alt', icon: '🍳', _o: 0 }, deleted: false, updated_at: '2026-11-03T10:00:00Z' },
    { kind: 'task', id: 't1', data: Object.assign({}, st.tasks[0], { lastDone: 110 }), deleted: false, updated_at: '2026-11-03T10:00:01Z' },
    { kind: 'member', id: 'm2', data: { id: 'm2', name: 'Ben', _o: 1 }, deleted: false, updated_at: '2026-11-03T10:00:02Z' },
    { kind: 'history', id: 'h1', data: null, deleted: true, updated_at: '2026-11-03T10:00:03Z' },
  ];
  const res = Sync.applyRemote(local, shadow, rows);
  assert.strictEqual(res.cursor, '2026-11-03T10:00:03Z');
  const merged = Sync.docsToState(local, st);
  assert.strictEqual(merged.rooms.find((r) => r.id === 'r2').name, 'Wohnküche'); // eigene Änderung gewinnt
  assert.strictEqual(merged.tasks.find((t) => t.id === 't1').lastDone, 110);
  assert.deepStrictEqual(merged.members.map((m) => m.name), ['Anna', 'Ben']);
  assert.strictEqual(merged.history.length, 0);
  // Die eigene Änderung steht weiter zum Hochladen an.
  const d = Sync.diff(shadow, Sync.stateToDocs(merged));
  assert.deepStrictEqual(d.upserts.map((u) => u.key), ['room:r2']);
});

test('applyRemote: das eigene Hochgeladene kommt zurück, ohne etwas zu ändern', () => {
  const docs = Sync.stateToDocs(sampleState());
  const shadow = Object.fromEntries(docs);
  const row = { kind: 'task', id: 't1', data: JSON.parse(docs.get('task:t1')), deleted: false, updated_at: 'x' };
  assert.strictEqual(Sync.applyRemote(docs, shadow, [row]).changed, false);
});

test('Doppeltes Abhaken auf zwei Geräten: das erste zählt', () => {
  const history = [
    { id: 'a', taskId: 't1', day: 200, at: 2000, dev: 'phone-b', memberId: 'm2' },
    { id: 'b', taskId: 't1', day: 200, at: 1000, dev: 'phone-a', memberId: 'm1' },
    { id: 'c', taskId: 't2', day: 200, at: 1500, dev: 'phone-a' },
    { id: 'd', taskId: 't2', day: 200, at: 1600, dev: 'phone-a' }, // selbes Gerät: bleibt
    { id: 'e', taskId: 't1', day: 201, at: 3000, dev: 'phone-b' },
    { id: 'f', taskId: 't1', day: 200, at: 900, dev: 'phone-b', skipped: true },
  ];
  const removed = Sync.dedupeCompletions(history);
  assert.deepStrictEqual(removed.map((h) => h.id), ['a']);
  assert.deepStrictEqual(history.map((h) => h.id).sort(), ['b', 'c', 'd', 'e', 'f']);
  assert.deepStrictEqual(Sync.dedupeCompletions(history), []);
});

test('Märkte und Preise werden im Haushalt abgeglichen', () => {
  const S = require('../sync.js');
  const state = {
    rooms: [], members: [], plants: [], tasks: [], history: [], shoppingLists: [], shoppingItems: [],
    stores: [{ id: 's1', name: 'Aldi Süd' }, { id: 's2', name: 'Rewe' }],
    prices: [{ id: 'p1', key: 'butter', name: 'Butter', storeId: 's1', cents: 179, at: 1 }],
    settings: { prices: { city: 'München', country: 'DE' } },
  };
  const docs = S.stateToDocs(state);
  assert.ok(docs.has('store:s1') && docs.has('price:p1'));
  const back = S.docsToState(docs, { settings: {} });
  assert.deepStrictEqual(back.stores.map((s) => s.name), ['Aldi Süd', 'Rewe']);
  assert.strictEqual(back.prices[0].cents, 179);
  assert.deepStrictEqual(back.settings.prices, { city: 'München', country: 'DE' });
});

const test = require('node:test');
const assert = require('node:assert');
const F = require('../feedback.js');

const memory = () => {
  const data = {};
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
};

test('baut eine Meldung mit getrimmtem Text', () => {
  const { row } = F.build({ kind: 'bug', message: '  Timer bleibt stehen  ', contact: '', includeMeta: false });
  assert.deepStrictEqual(row, { kind: 'bug', message: 'Timer bleibt stehen', contact: null, app_version: null, platform: null, context: null });
});

test('technische Infos nur, wenn gewünscht', () => {
  const meta = { appVersion: '1.0.12', platform: 'android', page: 'today', screen: '390x844', lang: 'de-DE', at: '2026-11-13' };
  const withMeta = F.build({ kind: 'idea', message: 'Dunkles Design', includeMeta: true, meta }).row;
  assert.strictEqual(withMeta.app_version, '1.0.12');
  assert.deepStrictEqual(withMeta.context, { page: 'today', screen: '390x844', lang: 'de-DE', at: '2026-11-13' });
  const without = F.build({ kind: 'idea', message: 'Dunkles Design', includeMeta: false, meta }).row;
  assert.strictEqual(without.app_version, null);
  assert.strictEqual(without.context, null);
});

test('prüft Art, Länge und Kontakt', () => {
  assert.ok(F.build({ kind: 'nope', message: 'Hallo Welt' }).error);
  assert.ok(F.build({ kind: 'bug', message: ' a ' }).error);
  assert.ok(F.build({ kind: 'bug', message: 'x'.repeat(F.MAX_LENGTH + 1) }).error);
  assert.ok(F.build({ kind: 'bug', message: 'Hallo Welt', contact: 'x'.repeat(201) }).error);
});

test('Warteschlange: sendet der Reihe nach und behält den Rest bei einem Fehler', async () => {
  const s = memory();
  F.enqueue(s, { message: 'a' });
  F.enqueue(s, { message: 'b' });
  F.enqueue(s, { message: 'c' });
  const sent = [];
  const n = await F.flush(s, async (row) => {
    if (row.message === 'b') throw new Error('offline');
    sent.push(row.message);
  });
  assert.strictEqual(n, 1);
  assert.deepStrictEqual(sent, ['a']);
  assert.deepStrictEqual(F.readQueue(s).map((r) => r.message), ['b', 'c']);
  assert.strictEqual(await F.flush(s, async () => {}), 2);
  assert.deepStrictEqual(F.readQueue(s), []);
});

test('Warteschlange ist begrenzt und übersteht kaputten Speicher', () => {
  const s = memory();
  for (let i = 0; i < 30; i++) F.enqueue(s, { message: String(i) });
  assert.strictEqual(F.readQueue(s).length, 20);
  s.setItem(F.QUEUE_KEY, '{kaputt');
  assert.deepStrictEqual(F.readQueue(s), []);
});

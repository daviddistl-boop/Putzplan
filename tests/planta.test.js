const test = require('node:test');
const assert = require('node:assert');
const P = require('../planta.js');

test('erkennt Gießen, Düngen, Umtopfen, Besprühen', () => {
  assert.strictEqual(P.parse('Zeit zum Gießen 💧', 'Deine Monstera braucht Wasser').key, 'water');
  assert.strictEqual(P.parse('Planta', 'Time to water your Pothos').key, 'water');
  assert.strictEqual(P.parse('Düngen', 'Gib deiner Calathea etwas Dünger').key, 'fertilize');
  assert.strictEqual(P.parse('Umtopfen', 'Deine Ficus wird zu groß für ihren Topf').key, 'repot');
  assert.strictEqual(P.parse('Besprühen', 'Deine Farne mögen Luftfeuchtigkeit').key, 'mist');
});

test('Umtopfen hat Vorrang vor Gießen, Werbung wird ignoriert', () => {
  assert.strictEqual(P.parse('Umtopfen & gießen', 'Topf wechseln und danach gießen').key, 'repot');
  assert.strictEqual(P.parse('Planta Premium', 'Jetzt 50 % sparen!'), null);
});

test('Notiz enthält den Text der Benachrichtigung', () => {
  assert.strictEqual(P.parse('Zeit zum Gießen', 'Monstera und 2 weitere').note, 'Monstera und 2 weitere');
});

const test = require('node:test');
const assert = require('node:assert');
const S = require('../scheduler.js');
const P = require('../plants.js');

const JULY = S.dateToDay(new Date(2026, 6, 6)); // Mo, 6.7.2026 – Sommer
const JANUARY = S.dateToDay(new Date(2026, 0, 12)); // Winter
const APRIL = S.dateToDay(new Date(2026, 3, 13)); // Frühjahr

function plant(extra) {
  return Object.assign({
    id: 'p1', name: 'Monstera', species: 'monstera', location: 'indoor', size: 'm', pot: 'plastic', light: 'eastwest',
    learn: 1, lastWatered: JULY, createdOn: JULY,
  }, extra);
}

const water = (p, day, weather) => P.careTasks(p, day, weather).find((t) => t.care === 'water');

test('Steckbriefe: mindestens 60 Arten, eindeutige Schlüssel, sinnvolle Werte', () => {
  assert.ok(P.SPECIES.length >= 60);
  assert.strictEqual(new Set(P.SPECIES.map((s) => s.key)).size, P.SPECIES.length);
  for (const s of P.SPECIES) {
    assert.ok(s.water >= 1 && s.water <= 30, s.key);
    assert.ok(s.name && s.latin, s.key);
  }
});

test('Grundintervall: Monstera im Sommer, mittlerer Plastiktopf, Ostfenster = 7 Tage', () => {
  assert.strictEqual(P.waterInterval(plant(), JULY), 7);
});

test('Topf, Material und Licht verändern das Intervall', () => {
  assert.ok(P.waterInterval(plant({ size: 's' }), JULY) < 7);
  assert.ok(P.waterInterval(plant({ size: 'l' }), JULY) > 7);
  assert.ok(P.waterInterval(plant({ pot: 'clay' }), JULY) < 7);
  assert.ok(P.waterInterval(plant({ light: 'south' }), JULY) < 7);
  assert.ok(P.waterInterval(plant({ light: 'room' }), JULY) > 7);
  assert.ok(P.waterInterval(plant({ light: 'north' }), JULY) > 7);
});

test('Jahreszeit: im Winter seltener, im Frühjahr etwas seltener', () => {
  assert.strictEqual(P.waterInterval(plant(), JANUARY), Math.round(7 * 1.6));
  assert.strictEqual(P.waterInterval(plant(), APRIL), Math.round(7 * 1.2));
});

test('Kaktus braucht viel seltener Wasser als ein Farn', () => {
  assert.ok(P.waterInterval(plant({ species: 'cactus' }), JULY) >= 14);
  assert.ok(P.waterInterval(plant({ species: 'nephrolepis' }), JULY) <= 4);
});

test('Lernen: „noch feucht“ verlängert, „ganz trocken“ verkürzt, begrenzt auf ×0,5 … ×2', () => {
  const p = plant();
  P.applyFeedback(p, 'wet');
  assert.ok(Math.abs(p.learn - 1.15) < 1e-9);
  assert.strictEqual(P.waterInterval(p, JULY), 8);
  P.applyFeedback(p, 'ok');
  assert.ok(Math.abs(p.learn - 1.15) < 1e-9);
  for (let i = 0; i < 20; i++) P.applyFeedback(p, 'wet');
  assert.strictEqual(p.learn, 2);
  for (let i = 0; i < 30; i++) P.applyFeedback(p, 'dry');
  assert.strictEqual(p.learn, 0.5);
});

test('Fälligkeit: letztes Gießen + Intervall, ungegossen sofort fällig', () => {
  assert.strictEqual(water(plant(), JULY).dueOn, JULY + 7);
  assert.strictEqual(water(plant({ lastWatered: null }), JULY).dueOn, JULY);
});

test('„Noch feucht – nicht gegossen“ verschiebt den Termin', () => {
  const p = plant({ lastWatered: JULY - 7 });
  assert.strictEqual(water(p, JULY).dueOn, JULY);
  p.waterNotBefore = JULY + P.recheckDays(p, JULY);
  assert.strictEqual(water(p, JULY).dueOn, JULY + 2);
});

test('Wasserspeicher: Angießphase 12 Wochen von oben, danach Speicher auffüllen', () => {
  const p = plant({ pot: 'reservoir', plantedOn: JULY });
  assert.ok(P.inRampUp(p, JULY + 10));
  assert.strictEqual(P.waterMode(p, JULY + 10), 'top');
  assert.strictEqual(P.waterInterval(p, JULY + 10), 7);
  assert.match(water(p, JULY + 10).note, /Angießphase/);
  const after = JULY + P.RAMP_UP_DAYS;
  assert.strictEqual(P.waterMode(p, after), 'reservoir');
  assert.match(water(p, after).name, /Wasserspeicher auffüllen/);
  assert.match(water(p, after).note, /ab jetzt den Wasserspeicher/);
  // Ohne Einpflanz-Datum gleich im Speicher-Modus, mit Faktor ×2,5.
  assert.strictEqual(P.waterInterval(plant({ pot: 'reservoir' }), JULY), Math.round(7 * 2.5));
});

test('Wasserspeicher: jedes vierte Auffüllen zusätzlich von oben gießen', () => {
  const names = [0, 1, 2, 3, 4, 5, 6, 7].map((refills) => water(plant({ pot: 'reservoir', refills }), JULY).name);
  const top = names.map((n) => /von oben/.test(n));
  assert.deepStrictEqual(top, [false, false, false, true, false, false, false, true]);
});

test('Wasserspeicher: Kakteen & Co. nur halb füllen', () => {
  assert.match(water(plant({ pot: 'reservoir', species: 'cactus' }), JULY).note, /halb/);
  assert.match(water(plant({ pot: 'reservoir' }), JULY).note, /max/);
});

test('Docht/Tonkegel: Wasser nachfüllen, Faktor ×2', () => {
  const p = plant({ pot: 'wick' });
  assert.match(water(p, JULY).name, /Wasser nachfüllen/);
  assert.strictEqual(P.waterInterval(p, JULY), 14);
});

test('Draußen: nach Regen fällt das Gießen aus, bei Hitze früher', () => {
  const out = plant({ species: 'pelargonium', location: 'outdoor', lastWatered: JULY - 5 });
  assert.strictEqual(water(out, JULY, { rain24: 0, tmax: 22, tmin: 12 }).dueOn, JULY - 2);
  const rained = water(out, JULY, { rain24: 8, tmax: 22, tmin: 12 });
  assert.strictEqual(rained.dueOn, JULY + 1);
  assert.match(rained.note, /geregnet/);
  // Wenig Regen zählt nicht.
  assert.strictEqual(water(out, JULY, { rain24: 2, tmax: 22, tmin: 12 }).dueOn, JULY - 2);
  // Hitze: Intervall ×0,7.
  const big = plant({ species: 'olive', location: 'outdoor' });
  assert.strictEqual(P.waterInterval(big, JULY, { tmax: 22 }), 7);
  assert.strictEqual(P.waterInterval(big, JULY, { tmax: 31 }), 5);
});

test('Draußen im Winter: keine festen Termine', () => {
  const out = plant({ species: 'olive', location: 'outdoor', lastWatered: JANUARY - 30 });
  const w = water(out, JANUARY, null);
  assert.strictEqual(w.dueOn, null);
  assert.match(w.note, /Winterpause/);
});

test('Frostwarnung unter 2 °C', () => {
  assert.strictEqual(P.frostWarning({ tmin: 1 }), true);
  assert.strictEqual(P.frostWarning({ tmin: 5 }), false);
  assert.strictEqual(P.frostWarning(null), false);
});

test('Düngen nur von März bis September', () => {
  const winterFeed = P.careTasks(plant({ lastFed: JANUARY - 20 }), JANUARY).find((t) => t.care === 'feed');
  assert.strictEqual(S.dayToDate(winterFeed.dueOn).getMonth(), 2); // März
  const summer = P.careTasks(plant({ lastFed: JULY }), JULY).find((t) => t.care === 'feed');
  assert.strictEqual(summer.dueOn, JULY + 14);
  // Basilikum wird nicht umgetopft.
  assert.ok(!P.careTasks(plant({ species: 'basil' }), JULY).some((t) => t.care === 'repot'));
});

test('Umtopfen im Frühjahr', () => {
  const repot = P.careTasks(plant({ repottedOn: JULY }), JULY).find((t) => t.care === 'repot');
  const d = S.dayToDate(repot.dueOn);
  assert.ok(d.getMonth() >= 2 && d.getMonth() <= 4, `Monat ${d.getMonth() + 1}`);
  assert.strictEqual(d.getFullYear(), 2029);
});

test('Suche und Zuordnung botanischer Namen (Foto-Erkennung)', () => {
  assert.strictEqual(P.search('monst')[0].key, 'monstera');
  assert.strictEqual(P.search('Ficus').length >= 4, true);
  assert.strictEqual(P.matchSpecies('Monstera deliciosa Liebm.').key, 'monstera');
  assert.strictEqual(P.matchSpecies('Sansevieria trifasciata Prain').key, 'sansevieria');
  // Unbekannte Art derselben Gattung → Gattung.
  assert.strictEqual(P.matchSpecies('Monstera adansonii', 'Monstera').key, 'monstera');
  // Unbekannte Gattung, bekannte Familie.
  assert.strictEqual(P.matchSpecies('Ferocactus wislizeni', 'Ferocactus', 'Cactaceae').key, 'cactus');
  assert.strictEqual(P.matchSpecies('Quercus robur', 'Quercus', 'Fagaceae'), null);
});

test('Open-Meteo: Regen der letzten 24 Stunden und Temperaturen', () => {
  const now = Date.parse('2026-07-06T12:00:00Z');
  const hours = [];
  const rain = [];
  for (let i = -30; i <= 30; i++) {
    const t = new Date(now + i * 3600 * 1000);
    hours.push(t.toISOString().slice(0, 13) + ':00');
    rain.push(i > -24 && i <= 0 ? 0.5 : 9);
  }
  const json = {
    utc_offset_seconds: 0,
    hourly: { time: hours, precipitation: rain },
    daily: { time: ['2026-07-05', '2026-07-06', '2026-07-07'], temperature_2m_max: [20, 30, 25], temperature_2m_min: [10, 12, 1] },
  };
  const w = P.parseWeather(json, now);
  assert.strictEqual(w.rain24, 12);
  assert.strictEqual(w.tmax, 30);
  assert.strictEqual(w.tmin, 1);
});

test('Planer: fällige Pflanzenpflege kommt immer dran, auch wenn das Budget voll ist', () => {
  const day = JULY;
  const tasks = [
    { id: 'big', roomId: 'r', name: 'Großputz', interval: 7, minutes: 60, lastDone: day - 10, paused: false },
    { id: 'pw', roomId: 'r', name: '💧 Monstera gießen', interval: 7, minutes: 2, plantId: 'p1', dueOn: day, lastDone: null, paused: false },
  ];
  const st = { tasks, members: [], settings: { minutesPerWeekday: [20, 20, 20, 20, 20, 20, 0] } };
  const [today] = S.planDays(st, day, 1);
  assert.ok(today.items.some((i) => i.task.id === 'pw'));
  assert.strictEqual(today.items[0].task.id, 'pw');
  // Nicht fällige Pflanzen werden nicht vorgezogen.
  tasks[1].dueOn = day + 3;
  const plan = S.planDays(st, day, 7);
  assert.deepStrictEqual(plan.map((d) => d.items.some((i) => i.task.id === 'pw')), [false, false, false, true, false, false, false]);
  // In der Simulation wird nach dem Gießen das Intervall weitergerechnet.
  tasks[1].dueOn = day;
  tasks[1].interval = 3;
  const sim = S.planDays(st, day, 7);
  assert.deepStrictEqual(sim.map((d) => d.items.some((i) => i.task.id === 'pw')), [true, false, false, true, false, false, true]);
});

test('Planer: „Pflanzen im Putzplan mitzählen“ aus → nicht im Plan, nicht in der Raum-Sauberkeit', () => {
  const t = { id: 'pw', roomId: 'r', name: '💧 Monstera gießen', interval: 7, minutes: 2, plantId: 'p1', dueOn: JULY, lastDone: null, paused: false };
  const st = { tasks: [t], members: [], settings: { minutesPerWeekday: [20, 20, 20, 20, 20, 20, 0], plants: { inPlan: false } } };
  assert.strictEqual(S.planDays(st, JULY, 1)[0].items.length, 0);
  assert.strictEqual(S.roomCleanliness([t], JULY, st.settings), 100);
  assert.strictEqual(S.isPlannable(t, JULY, {}), true);
});

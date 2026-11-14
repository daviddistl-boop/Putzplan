/*
 * Putzplan – Pflanzen: Steckbriefe und Pflege-Berechnung.
 *
 * Gegossen wird nicht nach festen Terminen. Die App schätzt, wie schnell die Erde
 * austrocknet, und kombiniert dafür:
 *   Grundbedarf der Art (Steckbrief) × Topfgröße × Topfmaterial × Licht/Standort
 *   × Jahreszeit × gelernter Faktor (Rückmeldung „noch feucht / passt / ganz trocken“)
 *   × Hitze (nur draußen).
 * Draußen fällt das Gießen nach Regen aus, im Winter gibt es nur Hinweise.
 *
 * Töpfe mit Wasserspeicher (z. B. Lechuza) werden in den ersten 12 Wochen nach dem
 * Einpflanzen normal von oben gegossen (Angießphase). Danach wird der Speicher
 * aufgefüllt, bei jedem vierten Mal zusätzlich von oben gegossen (spült Salze aus).
 *
 * Datumswerte sind ganze Tageszahlen wie im Scheduler.
 */
(function (root) {
  'use strict';

  const S = typeof module !== 'undefined' && module.exports ? require('./scheduler.js') : root.Scheduler;

  // ------------------------------------------------------------ Steckbriefe
  //
  // water: Tage zwischen zwei Wassergaben im Sommer – mittlerer Plastiktopf, Ost-/Westfenster
  //        (bei Balkon- und Gartenpflanzen: draußen, Halbschatten).
  // feed:  Tage zwischen zwei Düngergaben in der Wachstumszeit (März–September), 0 = nicht düngen.
  // repot: alle wie viele Jahre umtopfen, 0 = nicht nötig (z. B. einjährige Pflanzen).
  // dry:   mag es trocken (Kakteen, Sukkulenten, Orchideen) – Wasserspeicher nur halb füllen.
  // out:   typische Balkon- oder Gartenpflanze.
  const SPECIES = [
    // Grünpflanzen
    { key: 'monstera', name: 'Monstera', latin: 'Monstera deliciosa', water: 7, feed: 14, repot: 2 },
    { key: 'ficus-lyrata', name: 'Geigenfeige', latin: 'Ficus lyrata', water: 7, feed: 14, repot: 2 },
    { key: 'ficus-benjamina', name: 'Birkenfeige (Ficus benjamina)', latin: 'Ficus benjamina', water: 6, feed: 14, repot: 2 },
    { key: 'ficus-elastica', name: 'Gummibaum', latin: 'Ficus elastica', water: 9, feed: 21, repot: 2 },
    { key: 'ficus-ginseng', name: 'Ficus Ginseng (Bonsai)', latin: 'Ficus microcarpa', water: 4, feed: 14, repot: 2 },
    { key: 'pothos', name: 'Efeutute', latin: 'Epipremnum aureum', water: 7, feed: 14, repot: 2 },
    { key: 'philodendron', name: 'Philodendron', latin: 'Philodendron hederaceum', water: 7, feed: 14, repot: 2 },
    { key: 'sansevieria', name: 'Bogenhanf (Sansevieria)', latin: 'Dracaena trifasciata', alias: ['Sansevieria trifasciata', 'Sansevieria'], water: 18, feed: 30, repot: 3, dry: true },
    { key: 'zamioculcas', name: 'Glücksfeder (Zamioculcas)', latin: 'Zamioculcas zamiifolia', water: 16, feed: 30, repot: 3, dry: true },
    { key: 'spathiphyllum', name: 'Einblatt', latin: 'Spathiphyllum wallisii', water: 5, feed: 14, repot: 1 },
    { key: 'calathea', name: 'Korbmarante (Calathea)', latin: 'Goeppertia orbifolia', alias: ['Calathea'], water: 5, feed: 14, repot: 2 },
    { key: 'maranta', name: 'Pfeilwurz (Maranta)', latin: 'Maranta leuconeura', water: 5, feed: 14, repot: 2 },
    { key: 'chlorophytum', name: 'Grünlilie', latin: 'Chlorophytum comosum', water: 6, feed: 14, repot: 1 },
    { key: 'dracaena', name: 'Drachenbaum', latin: 'Dracaena marginata', water: 9, feed: 21, repot: 2 },
    { key: 'yucca', name: 'Yucca-Palme', latin: 'Yucca gigantea', alias: ['Yucca elephantipes'], water: 12, feed: 30, repot: 3 },
    { key: 'beaucarnea', name: 'Elefantenfuß', latin: 'Beaucarnea recurvata', water: 18, feed: 30, repot: 3, dry: true },
    { key: 'areca', name: 'Goldfruchtpalme', latin: 'Dypsis lutescens', water: 6, feed: 14, repot: 2 },
    { key: 'kentia', name: 'Kentiapalme', latin: 'Howea forsteriana', water: 8, feed: 21, repot: 3 },
    { key: 'chamaedorea', name: 'Bergpalme', latin: 'Chamaedorea elegans', water: 7, feed: 21, repot: 2 },
    { key: 'strelitzia', name: 'Paradiesvogelblume', latin: 'Strelitzia reginae', water: 8, feed: 14, repot: 2 },
    { key: 'alocasia', name: 'Alocasia (Elefantenohr)', latin: 'Alocasia macrorrhizos', water: 6, feed: 14, repot: 1 },
    { key: 'anthurium', name: 'Flamingoblume', latin: 'Anthurium andraeanum', water: 6, feed: 14, repot: 2 },
    { key: 'peperomia', name: 'Peperomie', latin: 'Peperomia obtusifolia', water: 10, feed: 30, repot: 2 },
    { key: 'pilea', name: 'Ufopflanze (Pilea)', latin: 'Pilea peperomioides', water: 7, feed: 21, repot: 1 },
    { key: 'nephrolepis', name: 'Schwertfarn', latin: 'Nephrolepis exaltata', water: 3, feed: 21, repot: 1 },
    { key: 'asplenium', name: 'Nestfarn', latin: 'Asplenium nidus', water: 4, feed: 21, repot: 2 },
    { key: 'adiantum', name: 'Frauenhaarfarn', latin: 'Adiantum raddianum', water: 3, feed: 30, repot: 1 },
    { key: 'hedera', name: 'Efeu', latin: 'Hedera helix', water: 6, feed: 21, repot: 1 },
    { key: 'tradescantia', name: 'Dreimasterblume', latin: 'Tradescantia zebrina', water: 6, feed: 21, repot: 1 },
    { key: 'hoya', name: 'Wachsblume (Hoya)', latin: 'Hoya carnosa', water: 10, feed: 30, repot: 3 },
    { key: 'schefflera', name: 'Strahlenaralie', latin: 'Schefflera arboricola', alias: ['Heptapleurum arboricola'], water: 8, feed: 21, repot: 2 },
    { key: 'aglaonema', name: 'Kolbenfaden (Aglaonema)', latin: 'Aglaonema commutatum', water: 8, feed: 21, repot: 2 },
    { key: 'dieffenbachia', name: 'Dieffenbachie', latin: 'Dieffenbachia seguine', water: 7, feed: 14, repot: 2 },
    { key: 'croton', name: 'Wunderstrauch (Croton)', latin: 'Codiaeum variegatum', water: 5, feed: 14, repot: 1 },
    { key: 'syngonium', name: 'Purpurtute (Syngonium)', latin: 'Syngonium podophyllum', water: 6, feed: 14, repot: 1 },
    { key: 'fittonia', name: 'Mosaikpflanze', latin: 'Fittonia albivenis', water: 3, feed: 21, repot: 1 },
    { key: 'oxalis', name: 'Glücksklee (Oxalis)', latin: 'Oxalis triangularis', water: 5, feed: 21, repot: 1 },
    // Blühende Zimmerpflanzen
    { key: 'phalaenopsis', name: 'Orchidee (Phalaenopsis)', latin: 'Phalaenopsis amabilis', alias: ['Phalaenopsis'], water: 8, feed: 21, repot: 2, dry: true },
    { key: 'begonia', name: 'Begonie', latin: 'Begonia elatior', alias: ['Begonia'], water: 5, feed: 14, repot: 1 },
    { key: 'hibiscus', name: 'Hibiskus (Roseneibisch)', latin: 'Hibiscus rosa-sinensis', water: 4, feed: 14, repot: 1 },
    { key: 'kalanchoe', name: 'Kalanchoe', latin: 'Kalanchoe blossfeldiana', water: 12, feed: 30, repot: 2, dry: true },
    { key: 'schlumbergera', name: 'Weihnachtskaktus', latin: 'Schlumbergera truncata', water: 7, feed: 21, repot: 2 },
    { key: 'guzmania', name: 'Bromelie (Guzmania)', latin: 'Guzmania lingulata', water: 7, feed: 30, repot: 0 },
    { key: 'saintpaulia', name: 'Usambaraveilchen', latin: 'Streptocarpus ionanthus', alias: ['Saintpaulia ionantha', 'Saintpaulia'], water: 5, feed: 14, repot: 1 },
    // Kakteen & Sukkulenten
    { key: 'aloe', name: 'Aloe vera', latin: 'Aloe vera', water: 18, feed: 30, repot: 2, dry: true },
    { key: 'echeveria', name: 'Echeverie', latin: 'Echeveria elegans', alias: ['Echeveria'], water: 14, feed: 30, repot: 2, dry: true },
    { key: 'crassula', name: 'Geldbaum (Crassula)', latin: 'Crassula ovata', water: 16, feed: 30, repot: 3, dry: true },
    { key: 'haworthia', name: 'Haworthie', latin: 'Haworthiopsis attenuata', alias: ['Haworthia'], water: 16, feed: 30, repot: 2, dry: true },
    { key: 'cactus', name: 'Kaktus', latin: 'Mammillaria', alias: ['Cactaceae', 'Opuntia', 'Echinocactus', 'Cereus', 'Gymnocalycium'], water: 21, feed: 30, repot: 3, dry: true },
    // Kräuter
    { key: 'basil', name: 'Basilikum', latin: 'Ocimum basilicum', water: 2, feed: 14, repot: 0 },
    { key: 'mint', name: 'Minze', latin: 'Mentha spicata', alias: ['Mentha'], water: 3, feed: 21, repot: 1 },
    { key: 'parsley', name: 'Petersilie', latin: 'Petroselinum crispum', water: 3, feed: 21, repot: 0 },
    { key: 'chives', name: 'Schnittlauch', latin: 'Allium schoenoprasum', water: 3, feed: 21, repot: 1 },
    { key: 'rosemary', name: 'Rosmarin', latin: 'Salvia rosmarinus', alias: ['Rosmarinus officinalis'], water: 7, feed: 30, repot: 2, dry: true, out: true },
    { key: 'thyme', name: 'Thymian', latin: 'Thymus vulgaris', water: 7, feed: 30, repot: 2, dry: true, out: true },
    // Balkon & Garten
    { key: 'tomato', name: 'Tomate', latin: 'Solanum lycopersicum', water: 1, feed: 7, repot: 0, out: true },
    { key: 'strawberry', name: 'Erdbeere', latin: 'Fragaria × ananassa', alias: ['Fragaria'], water: 2, feed: 14, repot: 1, out: true },
    { key: 'pelargonium', name: 'Geranie', latin: 'Pelargonium zonale', alias: ['Pelargonium'], water: 3, feed: 7, repot: 1, out: true },
    { key: 'petunia', name: 'Petunie', latin: 'Petunia × atkinsiana', alias: ['Petunia'], water: 2, feed: 7, repot: 0, out: true },
    { key: 'lavender', name: 'Lavendel', latin: 'Lavandula angustifolia', alias: ['Lavandula'], water: 7, feed: 30, repot: 2, dry: true, out: true },
    { key: 'hydrangea', name: 'Hortensie', latin: 'Hydrangea macrophylla', water: 2, feed: 14, repot: 2, out: true },
    { key: 'rose', name: 'Rose', latin: 'Rosa', water: 3, feed: 14, repot: 2, out: true },
    { key: 'buxus', name: 'Buchsbaum', latin: 'Buxus sempervirens', water: 5, feed: 30, repot: 3, out: true },
    { key: 'olive', name: 'Olivenbaum', latin: 'Olea europaea', water: 7, feed: 21, repot: 3, out: true },
    { key: 'citrus', name: 'Zitrusbaum', latin: 'Citrus limon', alias: ['Citrus'], water: 4, feed: 14, repot: 2, out: true },
    { key: 'oleander', name: 'Oleander', latin: 'Nerium oleander', water: 3, feed: 14, repot: 2, out: true },
    { key: 'bougainvillea', name: 'Bougainvillea', latin: 'Bougainvillea glabra', alias: ['Bougainvillea'], water: 4, feed: 14, repot: 2, out: true },
  ];

  /** Standard-Profil, wenn die Art unbekannt ist. Das Intervall lässt sich von Hand einstellen. */
  const DEFAULT_SPECIES = { key: 'other', name: 'Andere Pflanze', latin: '', water: 7, feed: 30, repot: 2 };

  const POT_SIZES = [
    { key: 's', name: 'Klein (unter 12 cm)', factor: 0.8 },
    { key: 'm', name: 'Mittel', factor: 1 },
    { key: 'l', name: 'Groß (über 25 cm)', factor: 1.25 },
  ];

  const POT_TYPES = [
    { key: 'plastic', name: 'Plastik oder glasierte Keramik', factor: 1 },
    { key: 'clay', name: 'Ton / Terrakotta', factor: 0.85 },
    { key: 'reservoir', name: 'Wasserspeicher-Topf (z. B. Lechuza)', factor: 2.5 },
    { key: 'wick', name: 'Selbstbewässernd mit Docht oder Tonkegel', factor: 2 },
  ];

  const LIGHTS = [
    { key: 'south', name: 'Südfenster', outName: 'Sonnig', factor: 0.8 },
    { key: 'eastwest', name: 'Ost- oder Westfenster', outName: 'Halbschatten', factor: 1 },
    { key: 'north', name: 'Nordfenster', outName: 'Schattig', factor: 1.15 },
    { key: 'room', name: 'Mitten im Raum', factor: 1.3, indoorOnly: true },
  ];

  // Angießphase bei Wasserspeicher-Töpfen und Rhythmus des Gießens von oben.
  const RAMP_UP_DAYS = 84;
  const TOP_WATER_EVERY = 4;
  // Lernen aus der Rückmeldung.
  const LEARN_STEP = 0.15;
  const LEARN_MIN = 0.5;
  const LEARN_MAX = 2;
  // Wetter.
  const RAIN_SKIP_MM = 5;
  const HEAT_C = 28;
  const HEAT_FACTOR = 0.7;
  const FROST_C = 2;
  // Topfpflanzen draußen trocknen schneller als ihr Zimmer-Steckbrief annimmt.
  const OUTDOOR_FACTOR = 0.8;

  const findBy = (list, key, fallback) => list.find((x) => x.key === key) || fallback;

  function species(key) {
    return findBy(SPECIES, key, DEFAULT_SPECIES);
  }

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[×x]\s/g, '').replace(/\s+/g, ' ').trim();
  }

  /** Suche in den Steckbriefen nach deutschem oder botanischem Namen. */
  function search(query) {
    const q = norm(query);
    if (!q) return SPECIES.slice().sort((a, b) => a.name.localeCompare(b.name, 'de'));
    return SPECIES.filter((s) => [s.name, s.latin].concat(s.alias || []).some((n) => norm(n).includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  /**
   * Passender Steckbrief zu einem botanischen Namen (z. B. aus der Foto-Erkennung):
   * erst die Art, dann die Gattung, dann die Familie. null = nicht gefunden.
   */
  function matchSpecies(scientificName, genus, family) {
    const name = norm(scientificName).split(' ').slice(0, 2).join(' ');
    const g = norm(genus) || name.split(' ')[0];
    const f = norm(family);
    const names = (s) => [s.latin].concat(s.alias || []).map(norm);
    return SPECIES.find((s) => names(s).includes(name))
      || SPECIES.find((s) => names(s).some((n) => n.split(' ')[0] === g))
      || (f ? SPECIES.find((s) => names(s).includes(f)) : null)
      || null;
  }

  // ------------------------------------------------------------ Jahreszeit

  function month(day) {
    return S.dayToDate(day).getMonth() + 1;
  }

  /** Erster Tag des Monats `m` im selben oder (falls schon vorbei) im nächsten Jahr. */
  function nextMonthStart(day, m) {
    const d = S.dayToDate(day);
    let y = d.getFullYear();
    if (d.getMonth() + 1 > m || (d.getMonth() + 1 === m && d.getDate() > 1)) y += 1;
    return S.dateToDay(new Date(y, m - 1, 1));
  }

  /**
   * Faktor für die Jahreszeit: Im Winter wachsen Pflanzen kaum und brauchen weniger Wasser,
   * die Heizungsluft gleicht das teilweise aus.
   */
  function seasonFactor(day) {
    const m = month(day);
    if (m === 12 || m <= 2) return 1.6;
    if (m === 3 || m === 4 || m === 10 || m === 11) return 1.2;
    return 1;
  }

  /** Winterpause draußen (Dezember bis Februar): nur Hinweise, keine festen Termine. */
  function isOutdoorWinter(day) {
    const m = month(day);
    return m === 12 || m <= 2;
  }

  /** Wachstumszeit zum Düngen: März bis September. */
  function isGrowingSeason(day) {
    const m = month(day);
    return m >= 3 && m <= 9;
  }

  // ------------------------------------------------------------ Wasserspeicher

  /** Wasserspeicher-Topf in der Angießphase (erste 12 Wochen nach dem Einpflanzen)? */
  function inRampUp(plant, day) {
    return plant.pot === 'reservoir' && typeof plant.plantedOn === 'number' && day < plant.plantedOn + RAMP_UP_DAYS;
  }

  /** Wie wird gegossen? 'top' = normal von oben, 'reservoir' = Speicher auffüllen, 'wick' = Wasser nachfüllen. */
  function waterMode(plant, day) {
    if (plant.pot === 'reservoir') return inRampUp(plant, day) ? 'top' : 'reservoir';
    if (plant.pot === 'wick') return 'wick';
    return 'top';
  }

  /** Muss beim nächsten Auffüllen des Speichers zusätzlich von oben gegossen werden? */
  function topWaterDue(plant) {
    return ((plant.refills || 0) + 1) % TOP_WATER_EVERY === 0;
  }

  // ------------------------------------------------------------ Berechnung

  function isOutdoor(plant) {
    return plant.location === 'outdoor';
  }

  function clampLearn(x) {
    return Math.min(LEARN_MAX, Math.max(LEARN_MIN, x));
  }

  /**
   * Tage bis zur nächsten Wassergabe an diesem Tag – mit allen Faktoren.
   * `weather` = { rain24, tmax, tmin } oder null.
   */
  function waterInterval(plant, day, weather) {
    const sp = species(plant.species);
    const base = plant.customWater || sp.water;
    const mode = waterMode(plant, day);
    const potFactor = mode === 'top' ? (plant.pot === 'clay' ? 0.85 : 1) : findBy(POT_TYPES, plant.pot, POT_TYPES[0]).factor;
    let f = findBy(POT_SIZES, plant.size, POT_SIZES[1]).factor
      * potFactor
      * findBy(LIGHTS, plant.light, LIGHTS[1]).factor
      * seasonFactor(day)
      * clampLearn(plant.learn || 1);
    if (isOutdoor(plant)) {
      if (!sp.out) f *= OUTDOOR_FACTOR;
      if (weather && weather.tmax > HEAT_C) f *= HEAT_FACTOR;
    }
    return Math.max(1, Math.round(base * f));
  }

  /** Name und Hinweis für die Wasser-Aufgabe. */
  function waterLabel(plant, day) {
    const sp = species(plant.species);
    const mode = waterMode(plant, day);
    const n = plant.name;
    if (mode === 'reservoir') {
      const fill = sp.dry ? 'Nur halb voll füllen (mag es trocken).' : 'Bis zur Markierung „max.“ füllen.';
      const first = typeof plant.plantedOn === 'number' && !(plant.refills > 0)
        ? 'Angießphase vorbei – ab jetzt den Wasserspeicher füllen. ' : '';
      if (topWaterDue(plant)) {
        return { name: `💧 ${n}: Wasserspeicher auffüllen + von oben gießen`, note: `${first}Diesmal auch von oben gießen – das spült Salze aus der Erde. ${fill}` };
      }
      return { name: `💧 ${n}: Wasserspeicher auffüllen`, note: `${first}${fill} Erst nachfüllen, wenn die Anzeige ein paar Tage auf „min.“ stand.` };
    }
    if (mode === 'wick') return { name: `💧 ${n}: Wasser nachfüllen`, note: 'Wasservorrat für Docht bzw. Tonkegel auffüllen.' };
    if (plant.pot === 'reservoir') {
      return { name: `💧 ${n} gießen`, note: 'Angießphase: von oben auf die Erde gießen, bis die Wurzeln den Wasserspeicher erreichen.' };
    }
    return { name: `💧 ${n} gießen`, note: '' };
  }

  /**
   * Die Pflegeaufgaben einer Pflanze an diesem Tag:
   * [{ care: 'water'|'feed'|'repot', name, note, dueOn, interval, minutes }].
   * dueOn = null heißt: ruht gerade (z. B. Winterpause draußen).
   */
  function careTasks(plant, day, weather) {
    const sp = species(plant.species);
    const out = [];
    const outdoor = isOutdoor(plant);

    // Gießen
    const interval = waterInterval(plant, day, weather);
    const label = waterLabel(plant, day);
    let dueOn = typeof plant.lastWatered === 'number' ? plant.lastWatered + interval : day;
    // „Erde war noch feucht – nicht gegossen“: frühestens an diesem Tag wieder nachsehen.
    if (typeof plant.waterNotBefore === 'number' && plant.waterNotBefore > dueOn) dueOn = plant.waterNotBefore;
    let note = label.note;
    if (outdoor && isOutdoorWinter(day)) {
      dueOn = null;
      note = 'Winterpause draußen – nur an frostfreien Tagen gießen, wenn die Erde ganz trocken ist.';
    } else if (outdoor && weather && weather.rain24 >= RAIN_SKIP_MM && dueOn <= day) {
      dueOn = day + 1; // Hat geregnet – heute fällt das Gießen aus.
      note = `🌧️ Es hat ${Math.round(weather.rain24)} mm geregnet – Gießen fällt heute aus.`;
    } else if (outdoor && weather && weather.tmax > HEAT_C) {
      note = `${note ? note + ' ' : ''}☀️ Heute bis ${Math.round(weather.tmax)} °C – lieber morgens oder abends gießen.`;
    }
    out.push({ care: 'water', name: label.name, note, dueOn, interval, minutes: plant.size === 'l' ? 3 : 2 });

    // Düngen (März bis September)
    if (sp.feed) {
      const feedEvery = Math.round(sp.feed * (plant.pot === 'reservoir' || plant.pot === 'wick' ? 1.5 : 1));
      let feedDue = typeof plant.lastFed === 'number' ? plant.lastFed + feedEvery : day;
      if (!isGrowingSeason(feedDue)) feedDue = Math.max(feedDue, nextMonthStart(feedDue, 3));
      out.push({
        care: 'feed', name: `🌱 ${plant.name} düngen`, interval: feedEvery, minutes: 2, dueOn: feedDue,
        note: plant.pot === 'reservoir' && waterMode(plant, day) === 'reservoir' ? 'Flüssigdünger ins Wasser des Speichers geben.' : 'Flüssigdünger ins Gießwasser geben.',
      });
    }

    // Umtopfen (im Frühjahr, März bis Mai)
    if (sp.repot) {
      const last = typeof plant.repottedOn === 'number' ? plant.repottedOn : (plant.createdOn || day);
      let repotDue = last + Math.round(sp.repot * 365);
      const m = month(repotDue);
      if (m < 3 || m > 5) repotDue = nextMonthStart(repotDue, 3);
      out.push({
        care: 'repot', name: `🪴 ${plant.name} umtopfen`, interval: Math.round(sp.repot * 365), minutes: 20, dueOn: repotDue,
        note: 'Frische Erde, Topf höchstens 2–4 cm größer. Danach erst nach 6 Wochen wieder düngen.',
      });
    }
    return out;
  }

  /**
   * Rückmeldung beim Gießen: 'wet' (Erde noch feucht) → Intervall 15 % länger,
   * 'dry' (schon ganz trocken) → 15 % kürzer, 'ok' → unverändert. Gibt den neuen Faktor zurück.
   */
  function applyFeedback(plant, value) {
    const cur = clampLearn(plant.learn || 1);
    const next = value === 'wet' ? cur * (1 + LEARN_STEP) : value === 'dry' ? cur * (1 - LEARN_STEP) : cur;
    plant.learn = Math.round(clampLearn(next) * 1000) / 1000;
    return plant.learn;
  }

  // ------------------------------------------------------------ Wetter (Open-Meteo)

  /** Adresse der Wettervorhersage für einen Ort. */
  function weatherUrl(lat, lon) {
    return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + '&hourly=precipitation&daily=temperature_2m_max,temperature_2m_min&past_days=1&forecast_days=2&timezone=auto';
  }

  /** Adresse der Ortssuche. */
  function geocodeUrl(name) {
    return `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=6&language=de&format=json`;
  }

  /**
   * Fasst die Antwort von Open-Meteo zusammen: Regen der letzten 24 Stunden (mm),
   * Höchsttemperatur heute, Tiefsttemperatur heute/morgen.
   */
  function parseWeather(json, nowMs) {
    const h = json && json.hourly;
    const d = json && json.daily;
    if (!h || !d) return null;
    const offset = (json.utc_offset_seconds || 0) * 1000;
    // Zeiten kommen als Ortszeit ohne Zone („2026-07-01T14:00“).
    const toMs = (s) => Date.parse(`${s}:00Z`) - offset;
    let rain24 = 0;
    h.time.forEach((t, i) => {
      const ms = toMs(t);
      if (ms <= nowMs && ms > nowMs - 24 * 3600 * 1000) rain24 += h.precipitation[i] || 0;
    });
    const todayStr = new Date(nowMs + offset).toISOString().slice(0, 10);
    const idx = Math.max(0, d.time.indexOf(todayStr));
    return {
      rain24: Math.round(rain24 * 10) / 10,
      tmax: d.temperature_2m_max[idx],
      tmin: Math.min(d.temperature_2m_min[idx], d.temperature_2m_min[idx + 1] ?? Infinity),
      at: nowMs,
    };
  }

  /** Frostwarnung für Pflanzen draußen? */
  function frostWarning(weather) {
    return !!(weather && typeof weather.tmin === 'number' && weather.tmin < FROST_C);
  }

  /** Wie viele Tage später man nachsieht, wenn die Erde beim Gießen noch feucht war. */
  function recheckDays(plant, day) {
    return Math.max(1, Math.round(waterInterval(plant, day) * 0.25));
  }

  // ------------------------------------------------------------ Kompass
  //
  // Hilft bei der Frage „In welche Richtung zeigt das Fenster?“: Man hält das Handy flach,
  // die Oberkante zeigt aus dem Fenster. Daraus wird die Licht-Stufe der Pflanze.

  const DIRECTIONS = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'];
  const DIRECTIONS_SHORT = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];

  const wrap = (deg) => ((deg % 360) + 360) % 360;

  /**
   * Himmelsrichtung, in die die Oberkante des Handys zeigt (0 = Norden, 90 = Osten), aus
   * einem Lage-Ereignis des Browsers – oder null, wenn es keine Nordrichtung enthält.
   * `screenAngle`: Drehung des Bildschirms (0 hochkant, 90 quer …).
   */
  function headingFromOrientation(e, screenAngle) {
    if (!e) return null;
    let h = null;
    if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading; // iPhone
    else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha; // Android: alpha zählt gegen den Uhrzeigersinn
    if (h === null) return null;
    return wrap(h + (screenAngle || 0));
  }

  /** Gleitender Mittelwert für Winkel (über 359° → 0° hinweg), damit die Nadel nicht zittert. */
  function smoothHeading(prev, next, weight) {
    if (prev === null || prev === undefined) return next;
    const w = weight === undefined ? 0.25 : weight;
    const diff = wrap(next - prev + 180) - 180;
    return wrap(prev + diff * w);
  }

  function directionName(deg, short) {
    const i = Math.round(wrap(deg) / 45) % 8;
    return (short ? DIRECTIONS_SHORT : DIRECTIONS)[i];
  }

  /** Fensterrichtung → Licht-Stufe: Süden (SO bis SW) sonnig, Norden (NW bis NO) schattig, sonst Ost/West. */
  function lightForHeading(deg) {
    const h = wrap(deg);
    if (h >= 135 && h < 225) return 'south';
    if (h >= 315 || h < 45) return 'north';
    return 'eastwest';
  }

  const api = {
    DIRECTIONS, headingFromOrientation, smoothHeading, directionName, lightForHeading,
    SPECIES, DEFAULT_SPECIES, POT_SIZES, POT_TYPES, LIGHTS,
    RAMP_UP_DAYS, TOP_WATER_EVERY, RAIN_SKIP_MM, HEAT_C, FROST_C,
    species, search, matchSpecies,
    seasonFactor, isOutdoorWinter, isGrowingSeason, nextMonthStart,
    inRampUp, waterMode, topWaterDue, isOutdoor,
    waterInterval, waterLabel, careTasks, applyFeedback, recheckDays,
    weatherUrl, geocodeUrl, parseWeather, frostWarning,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Plants = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

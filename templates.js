/* Putzplan – Vorlagen für Räume und typische Aufgaben (Intervall in Tagen, Dauer in Minuten). */
(function (root) {
  'use strict';

  const ROOM_TEMPLATES = [
    {
      key: 'kitchen', name: 'Küche', icon: '🍳',
      tasks: [
        ['Geschirr spülen / Spülmaschine', 1, 15],
        ['Arbeitsflächen abwischen', 1, 5],
        ['Müll rausbringen', 3, 5],
        ['Herd reinigen', 7, 10],
        ['Boden wischen', 7, 15],
        ['Spüle & Armaturen reinigen', 7, 5],
        ['Mikrowelle reinigen', 14, 5],
        ['Kühlschrank auswischen', 30, 20],
        ['Backofen reinigen', 60, 30],
        ['Schränke auswischen', 180, 45],
      ],
    },
    {
      key: 'bath', name: 'Badezimmer', icon: '🛁',
      tasks: [
        ['Waschbecken reinigen', 4, 5],
        ['Toilette putzen', 7, 10],
        ['Dusche / Badewanne reinigen', 7, 15],
        ['Spiegel putzen', 7, 5],
        ['Handtücher wechseln', 7, 5],
        ['Boden wischen', 7, 10],
        ['Fliesenfugen schrubben', 60, 30],
        ['Abfluss reinigen', 30, 10],
      ],
    },
    {
      key: 'wc', name: 'Gäste-WC', icon: '🚽',
      tasks: [
        ['Toilette putzen', 7, 10],
        ['Waschbecken reinigen', 7, 5],
        ['Boden wischen', 14, 5],
      ],
    },
    {
      key: 'living', name: 'Wohnzimmer', icon: '🛋️',
      tasks: [
        ['Aufräumen', 2, 10],
        ['Staubsaugen', 7, 15],
        ['Staub wischen', 14, 15],
        ['Sofa absaugen', 30, 10],
        ['Fenster putzen', 60, 30],
      ],
    },
    {
      key: 'bedroom', name: 'Schlafzimmer', icon: '🛏️',
      tasks: [
        ['Aufräumen', 3, 5],
        ['Staubsaugen', 7, 10],
        ['Bettwäsche wechseln', 14, 15],
        ['Staub wischen', 14, 10],
        ['Matratze absaugen & wenden', 90, 20],
        ['Fenster putzen', 60, 20],
      ],
    },
    {
      key: 'kids', name: 'Kinderzimmer', icon: '🧸',
      tasks: [
        ['Aufräumen', 2, 10],
        ['Staubsaugen', 7, 10],
        ['Bettwäsche wechseln', 14, 15],
        ['Spielzeug reinigen', 30, 20],
      ],
    },
    {
      key: 'office', name: 'Arbeitszimmer', icon: '💻',
      tasks: [
        ['Schreibtisch aufräumen', 7, 10],
        ['Staubsaugen', 7, 10],
        ['Staub wischen', 14, 10],
        ['Bildschirm & Tastatur reinigen', 30, 5],
      ],
    },
    {
      key: 'hall', name: 'Flur', icon: '🚪',
      tasks: [
        ['Schuhe aufräumen', 7, 5],
        ['Staubsaugen', 7, 10],
        ['Boden wischen', 14, 10],
      ],
    },
    {
      key: 'laundry', name: 'Waschküche', icon: '🧺',
      tasks: [
        ['Wäsche waschen & aufhängen', 3, 15], // Folgeaufgabe „Wäsche abnehmen“ kommt automatisch dazu
        ['Wäsche zusammenlegen & wegräumen', 3, 15],
        ['Waschmaschine reinigen', 60, 15],
      ],
    },
    {
      key: 'balcony', name: 'Balkon', icon: '🌿',
      tasks: [
        ['Pflanzen gießen', 3, 5],
        ['Balkon fegen', 14, 10],
        ['Geländer & Möbel abwischen', 60, 15],
      ],
    },
    {
      key: 'general', name: 'Allgemein', icon: '🏠',
      tasks: [
        ['Zimmerpflanzen gießen', 4, 5],
        ['Altpapier & Altglas wegbringen', 14, 10],
        ['Lichtschalter & Türklinken abwischen', 30, 10],
      ],
    },
  ];

  // Wartung für Saug- und Wischroboter: [Schlüssel, Name, Intervall, Dauer, benötigter Robotertyp]
  const ROBOT_TASKS = [
    ['bin', 'Staubbehälter leeren', 3, 2, 'vacuum'],
    ['brush', 'Bürsten & Filter reinigen', 14, 10, 'vacuum'],
    ['sensors', 'Sensoren & Räder abwischen', 30, 5, 'vacuum'],
    ['tank', 'Wassertank auffüllen & Wischpads waschen', 3, 5, 'mop'],
    ['station', 'Station & Schmutzwassertank reinigen', 14, 10, 'mop'],
  ];

  // Allergiker-Modus: Allergien, Zusatzaufgaben und Tipps.
  const ALLERGIES = [
    { key: 'mites', name: 'Hausstaubmilben', icon: '🛏️' },
    { key: 'pollen', name: 'Pollen', icon: '🌼', note: 'nur in der Pollensaison (Feb.–Sep.)' },
    { key: 'pets', name: 'Tierhaare', icon: '🐾' },
    { key: 'mold', name: 'Schimmel', icon: '🍄' },
  ];

  // [Schlüssel, Name, Intervall, Dauer, Allergie, bevorzugte Räume]
  const ALLERGY_TASKS = [
    ['mite-pillows', 'Kopfkissen & Bettdecke bei 60 °C waschen', 90, 20, 'mites', ['Schlafzimmer']],
    ['mite-plush', 'Kuscheltiere waschen oder 24 h einfrieren', 30, 10, 'mites', ['Kinderzimmer', 'Schlafzimmer']],
    ['mite-filter', 'Staubsauger-Filter (HEPA) prüfen & wechseln', 90, 5, 'mites', ['Allgemein']],
    ['pollen-sills', 'Fensterbänke & Rahmen feucht abwischen', 7, 10, 'pollen', ['Wohnzimmer', 'Schlafzimmer']],
    ['pollen-screen', 'Pollenschutzgitter absaugen', 30, 10, 'pollen', ['Schlafzimmer', 'Wohnzimmer']],
    ['pollen-clothes', 'Getragene Kleidung aus dem Schlafzimmer räumen', 2, 3, 'pollen', ['Schlafzimmer']],
    ['pets-lint', 'Fusselrolle über Sofa & Kissen', 3, 5, 'pets', ['Wohnzimmer']],
    ['pets-bed', 'Tierdecken & Körbchen waschen', 7, 10, 'pets', ['Allgemein', 'Wohnzimmer']],
    ['pets-brush', 'Haustier draußen bürsten', 7, 10, 'pets', ['Allgemein']],
    ['mold-squeegee', 'Dusche nach dem Duschen abziehen', 1, 2, 'mold', ['Badezimmer']],
    ['mold-check', 'Silikonfugen & Ecken auf Schimmel prüfen', 30, 5, 'mold', ['Badezimmer', 'Allgemein']],
    ['mold-condensate', 'Kondenswasser an Fenstern abwischen', 2, 3, 'mold', ['Schlafzimmer', 'Allgemein']],
    ['mold-machine', 'Waschmaschinen-Dichtung trocknen, Tür offen lassen', 7, 2, 'mold', ['Waschküche', 'Badezimmer']],
  ];

  const ALLERGY_TIPS = {
    mites: [
      'Bettwäsche, Kissen und Decken bei mindestens 60 °C waschen',
      'Milbendichte Bezüge (Encasings) für Matratze, Kissen und Decke',
      'Staubsauger mit HEPA-Filter nutzen, Staub feucht statt trocken wischen',
      'Schlafzimmer eher kühl (ca. 18 °C) und trocken halten',
    ],
    pollen: [
      'Abends Haare waschen und getragene Kleidung nicht im Schlafzimmer ablegen',
      'Wäsche in der Pollensaison drinnen trocknen',
      'In der Stadt eher früh morgens, auf dem Land eher abends lüften',
      'Pollenschutzgitter an Schlafzimmerfenstern helfen',
    ],
    pets: [
      'Haustiere möglichst aus dem Schlafzimmer fernhalten',
      'Polster oft absaugen – glatte Böden sind leichter sauber zu halten als Teppich',
      'Nach dem Streicheln Hände waschen',
    ],
    mold: [
      'Stoß- statt Kipplüften, mehrmals täglich ein paar Minuten',
      'Luftfeuchtigkeit möglichst unter 60 % halten (Hygrometer hilft)',
      'Möbel mit etwas Abstand zu Außenwänden stellen',
    ],
  };

  const ROOM_ICONS = ['🤖', '🍳', '🛁', '🚽', '🛋️', '🛏️', '🧸', '💻', '🚪', '🧺', '🌿', '🏠', '🚗', '🐶', '🪴', '📚', '🍽️'];

  const INTERVALS = [
    [1, 'Täglich'],
    [2, 'Alle 2 Tage'],
    [3, 'Alle 3 Tage'],
    [4, '2× pro Woche'],
    [7, 'Wöchentlich'],
    [14, 'Alle 2 Wochen'],
    [30, 'Monatlich'],
    [60, 'Alle 2 Monate'],
    [90, 'Vierteljährlich'],
    [180, 'Halbjährlich'],
    [365, 'Jährlich'],
  ];

  const MEMBER_COLORS = ['#4f8cff', '#ff7a59', '#2fbf71', '#b06cff', '#f5b700', '#ff5c8a'];

  const api = { ROOM_TEMPLATES, ROBOT_TASKS, ALLERGIES, ALLERGY_TASKS, ALLERGY_TIPS, ROOM_ICONS, INTERVALS, MEMBER_COLORS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Templates = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

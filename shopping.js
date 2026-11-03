/*
 * Putzplan – Einkaufsliste: Katalog, Kategorien, Suche und Vorschläge.
 *
 * Reine Daten und Logik, ohne Oberfläche. Die Kategorien folgen grob dem Weg durch
 * einen Supermarkt, damit die Liste beim Einkaufen von oben nach unten passt.
 */
(function (root) {
  'use strict';

  const CATEGORIES = [
    { key: 'fruit', name: 'Obst & Gemüse', icon: '🥦' },
    { key: 'bakery', name: 'Brot & Backwaren', icon: '🥖' },
    { key: 'dairy', name: 'Kühlregal', icon: '🧀' },
    { key: 'meat', name: 'Fleisch & Fisch', icon: '🥩' },
    { key: 'frozen', name: 'Tiefkühl', icon: '🧊' },
    { key: 'pantry', name: 'Vorrat', icon: '🥫' },
    { key: 'drinks', name: 'Getränke', icon: '🥤' },
    { key: 'drugstore', name: 'Drogerie', icon: '🧴' },
    { key: 'household', name: 'Haushalt & Putzmittel', icon: '🧽' },
    { key: 'other', name: 'Sonstiges', icon: '🛍️' },
  ];

  // Katalog: je Kategorie „Symbol Name“, optional „|Suchwort,Suchwort“.
  const RAW = {
    fruit: [
      '🍎 Äpfel', '🍌 Bananen', '🍐 Birnen', '🍊 Orangen', '🍋 Zitronen', '🍋‍🟩 Limetten', '🍇 Trauben', '🍓 Erdbeeren',
      '🫐 Heidelbeeren', '🍒 Kirschen', '🍑 Pfirsiche', '🥝 Kiwis', '🍍 Ananas', '🥭 Mango', '🍉 Wassermelone', '🥑 Avocado',
      '🍅 Tomaten', '🥒 Gurke', '🫑 Paprika', '🥕 Karotten|möhren', '🥔 Kartoffeln', '🧅 Zwiebeln', '🧄 Knoblauch',
      '🥬 Salat|kopfsalat,eisberg', '🥗 Rucola', '🥬 Spinat', '🥦 Brokkoli', '🥦 Blumenkohl', '🥬 Kohlrabi', '🥬 Weißkohl',
      '🥒 Zucchini', '🍆 Aubergine', '🍄 Champignons|pilze', '🌽 Mais', '🫛 Erbsen', '🫚 Ingwer', '🌶️ Chili', '🌿 Petersilie',
      '🌿 Basilikum', '🌿 Schnittlauch', '🥬 Lauch|porree', '🥬 Sellerie', '🍠 Süßkartoffeln', '🥗 Radieschen', '🫘 Frühlingszwiebeln',
    ],
    bakery: [
      '🍞 Brot', '🥖 Baguette', '🥐 Croissants', '🥯 Brötchen|semmeln,weckerl', '🍞 Toastbrot', '🍞 Vollkornbrot', '🥨 Brezeln',
      '🫓 Wraps|tortilla', '🍰 Kuchen', '🧇 Knäckebrot', '🥞 Zwieback',
    ],
    dairy: [
      '🥛 Milch', '🥛 Hafermilch|haferdrink', '🧈 Butter', '🧀 Käse', '🧀 Reibekäse', '🧀 Mozzarella', '🧀 Feta', '🧀 Frischkäse',
      '🍶 Joghurt', '🍶 Naturjoghurt', '🍶 Quark', '🍶 Skyr', '🥛 Sahne|schlagobers', '🥛 Saure Sahne|schmand,creme fraiche',
      '🥚 Eier', '🍮 Pudding', '🥓 Speck', '🌭 Würstchen|wiener', '🍖 Aufschnitt|wurst', '🍕 Pizzateig', '🥟 Tortellini',
      '🥗 Hummus', '🧈 Margarine', '🍶 Kefir', '🍹 Orangensaft frisch',
    ],
    meat: [
      '🥩 Hackfleisch|faschiertes', '🍗 Hähnchenbrust|hühnerbrust', '🍗 Hähnchenschenkel', '🥩 Rindfleisch', '🥩 Schweinefleisch',
      '🥩 Schnitzel', '🥩 Steak', '🌭 Bratwurst', '🥓 Schinken', '🐟 Lachs', '🐟 Fischfilet', '🦐 Garnelen', '🐟 Thunfisch frisch',
      '🌱 Tofu', '🌱 Veggie-Hack|vegan,vegetarisch',
    ],
    frozen: [
      '🍕 Tiefkühlpizza', '🍟 Pommes', '🥦 TK-Gemüse|tiefkühlgemüse', '🫛 TK-Erbsen', '🫐 TK-Beeren', '🐟 Fischstäbchen',
      '🍦 Eis|eiscreme', '🥟 Maultaschen', '🥬 TK-Spinat', '🌿 TK-Kräuter',
    ],
    pantry: [
      '🍝 Nudeln|pasta,spaghetti', '🍚 Reis', '🌾 Mehl', '🍬 Zucker', '🧂 Salz', '🧂 Pfeffer', '🫒 Olivenöl', '🌻 Sonnenblumenöl|öl',
      '🍶 Essig', '🥣 Haferflocken', '🥣 Müsli', '🥣 Cornflakes', '🍯 Honig', '🍓 Marmelade', '🍫 Nutella|nougatcreme',
      '🥜 Erdnussbutter', '☕ Kaffee', '☕ Kaffeebohnen', '🫖 Tee', '🍫 Kakao', '🥫 Tomatenmark', '🥫 Passierte Tomaten|tomatensauce',
      '🥫 Dosentomaten', '🫘 Kidneybohnen', '🫘 Kichererbsen', '🥫 Mais Dose', '🥫 Thunfisch Dose', '🥫 Kokosmilch', '🍜 Brühe|bouillon',
      '🧂 Gewürze', '🌶️ Paprikapulver', '🍝 Pesto', '🍅 Ketchup', '🌭 Senf', '🥚 Mayonnaise|mayo', '🥫 Sojasauce', '🍫 Schokolade',
      '🍪 Kekse', '🥨 Chips', '🥜 Nüsse', '🍬 Gummibärchen', '🥜 Studentenfutter', '🧁 Backpulver', '🧁 Hefe', '🍮 Vanillezucker',
      '🍚 Couscous', '🌾 Linsen', '🌾 Bulgur', '🍿 Popcorn', '🥫 Suppe', '🍝 Lasagneplatten', '🌾 Semmelbrösel|paniermehl',
      '🍯 Ahornsirup', '🥣 Babybrei',
    ],
    drinks: [
      '💧 Wasser|mineralwasser,sprudel', '💧 Stilles Wasser', '🧃 Apfelsaft', '🧃 Orangensaft', '🧃 Saft', '🥤 Cola', '🥤 Limonade',
      '🥤 Eistee', '🍺 Bier', '🍷 Rotwein', '🥂 Weißwein', '🍾 Sekt|prosecco', '🥃 Spirituosen|schnaps', '⚡ Energydrink',
      '🧃 Sirup', '🥛 Kaffeemilch',
    ],
    drugstore: [
      '🧻 Toilettenpapier|klopapier', '🤧 Taschentücher', '🧻 Küchenrolle', '🪥 Zahnpasta', '🪥 Zahnbürste', '🦷 Zahnseide',
      '🧴 Duschgel', '🧴 Shampoo', '🧴 Spülung|conditioner', '🧼 Seife|handseife', '🧴 Deo', '🧴 Bodylotion', '🧴 Handcreme',
      '🧴 Sonnencreme', '🪒 Rasierer', '🪒 Rasierschaum', '🩹 Pflaster', '💊 Schmerztabletten', '🧽 Wattepads', '🦻 Wattestäbchen',
      '🩲 Slipeinlagen', '🩸 Tampons|binden', '👶 Windeln', '👶 Feuchttücher', '💄 Make-up-Entferner', '🧴 Gesichtscreme',
      '🧴 Haargel', '💅 Nagellackentferner', '🧴 Desinfektionsmittel',
    ],
    household: [
      '🍽️ Spülmittel', '🍽️ Spülmaschinentabs|tabs', '🧂 Spülmaschinensalz', '✨ Klarspüler', '👕 Waschmittel', '👕 Weichspüler',
      '👕 Fleckentferner', '👕 Hygienespüler', '🚽 WC-Reiniger|klostein', '🚽 WC-Steine', '🪣 Badreiniger', '🪣 Allzweckreiniger',
      '🪟 Glasreiniger|fensterreiniger', '🪣 Bodenreiniger', '🧴 Küchenreiniger|fettlöser', '🧪 Entkalker', '🧪 Rohrreiniger|abflussreiniger',
      '🧽 Schwämme', '🧽 Spültücher', '🧽 Mikrofasertücher|putztücher', '🧤 Gummihandschuhe', '🗑️ Müllbeutel|mülltüten',
      '🗑️ Biomüllbeutel', '💨 Staubsaugerbeutel', '🧹 Wischbezug|wischmopp', '🧹 Besen', '🚽 Klobürste', '🧺 Wäscheklammern',
      '🧻 Alufolie', '🧻 Frischhaltefolie', '🧻 Backpapier', '🧊 Gefrierbeutel', '🔋 Batterien', '💡 Glühbirnen|leuchtmittel',
      '🕯️ Kerzen', '🧯 Feuerzeug|streichhölzer', '🤖 Ersatzfilter Saugroboter|roboter', '🤖 Bürsten Saugroboter',
      '🤖 Wischpads Roboter', '🧴 Edelstahlreiniger', '🧴 Backofenreiniger', '🧴 Möbelpolitur', '🧴 Schimmelentferner',
      '🦟 Insektenspray', '🌬️ Duftkerze|raumduft', '🧴 Lederpflege', '🧽 Stahlwolle', '🧴 Ceranfeldreiniger',
    ],
    other: [
      '🪴 Blumenerde', '🌱 Dünger|flüssigdünger,pflanzendünger', '🌵 Kakteenerde', '🪴 Blumentopf', '🌱 Orchideenerde',
      '🐱 Katzenfutter', '🐶 Hundefutter', '🐱 Katzenstreu', '🦴 Leckerlis', '🎁 Geschenk', '💐 Blumen', '📮 Briefmarken',
      '🎂 Geburtstagskarte', '📝 Notizblock', '🖊️ Kugelschreiber', '🧷 Klebeband', '🪫 Ladekabel', '🧊 Eiswürfel', '⛽ Grillkohle',
      '🎈 Luftballons', '🧸 Spielzeug', '🧦 Socken',
    ],
  };

  function slug(s) {
    return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/\s+/g, ' ').trim();
  }

  const CATALOG = [];
  for (const c of CATEGORIES) {
    for (const entry of RAW[c.key] || []) {
      const [head, aliases] = entry.split('|');
      const sp = head.indexOf(' ');
      const icon = head.slice(0, sp);
      const name = head.slice(sp + 1);
      CATALOG.push({ key: slug(name), name, icon, cat: c.key, aliases: aliases ? aliases.split(',') : [] });
    }
  }
  const BY_KEY = new Map(CATALOG.map((i) => [i.key, i]));

  const category = (key) => CATEGORIES.find((c) => c.key === key) || CATEGORIES[CATEGORIES.length - 1];
  const item = (key) => BY_KEY.get(key) || null;

  /** Katalog-Eintrag zu einem eingetippten Namen (genau). */
  function findByName(name) {
    const n = norm(name);
    return CATALOG.find((i) => norm(i.name) === n || i.aliases.some((a) => norm(a) === n)) || null;
  }

  /** Suche: Wortanfänge zuerst, dann irgendwo im Namen oder in Suchwörtern. */
  function search(query, limit) {
    const q = norm(query);
    if (!q) return [];
    const scored = [];
    for (const i of CATALOG) {
      const n = norm(i.name);
      let score = -1;
      if (n === q) score = 0;
      else if (n.startsWith(q)) score = 1;
      else if (n.split(/[\s-]/).some((w) => w.startsWith(q))) score = 2;
      else if (i.aliases.some((a) => norm(a).startsWith(q))) score = 3;
      else if (n.includes(q) || i.aliases.some((a) => norm(a).includes(q))) score = 4;
      if (score >= 0) scored.push({ i, score });
    }
    scored.sort((a, b) => a.score - b.score || a.i.name.length - b.i.name.length || a.i.name.localeCompare(b.i.name, 'de'));
    return scored.slice(0, limit || 12).map((s) => s.i);
  }

  /** Symbol für einen frei eingetippten Artikel: aus dem Katalog, sonst das der Kategorie. */
  function iconFor(name, cat) {
    const hit = findByName(name)
      || norm(name).split(/[\s,/-]+/).filter((w) => w.length >= 3).map(findByName).find(Boolean);
    return hit ? hit.icon : category(cat).icon;
  }

  // ------------------------------------------------------------ Vorschläge zu Aufgaben

  // Welche Artikel passen zu einer Aufgabe? [Muster am Aufgabennamen, Katalog-Schlüssel]
  const TASK_SUGGESTIONS = [
    [/toilette|wc|klo/i, ['wc-reiniger', 'wc-steine', 'klobuerste', 'toilettenpapier']],
    [/dusche|badewanne|fliesen|fugen|waschbecken/i, ['badreiniger', 'entkalker', 'schimmelentferner', 'schwaemme']],
    [/abfluss/i, ['rohrreiniger']],
    [/spiegel|fenster|glas/i, ['glasreiniger', 'mikrofasertuecher']],
    [/boden.*wisch|wischen.*boden|feucht/i, ['bodenreiniger', 'wischbezug']],
    [/saug/i, ['staubsaugerbeutel']],
    [/staub ?wisch|abstaub/i, ['mikrofasertuecher', 'moebelpolitur']],
    [/geschirr|spülmaschine|spuelmaschine/i, ['spuelmaschinentabs', 'spuelmaschinensalz', 'klarspueler', 'spuelmittel']],
    [/arbeitsfläche|spüle|spuele|küche|kueche/i, ['kuechenreiniger', 'spueltuecher', 'schwaemme']],
    [/herd|ceran/i, ['ceranfeldreiniger', 'kuechenreiniger']],
    [/backofen/i, ['backofenreiniger']],
    [/mikrowelle|kühlschrank|kuehlschrank|schränke|schraenke/i, ['allzweckreiniger', 'spueltuecher']],
    [/müll|muell/i, ['muellbeutel', 'biomuellbeutel']],
    [/wäsche|waesche|bettwäsche|handtücher|handtuecher/i, ['waschmittel', 'weichspueler', 'fleckentferner', 'waescheklammern']],
    [/waschmaschine/i, ['hygienespueler', 'entkalker']],
    [/staubbehälter|bürsten|buersten|filter|sensoren/i, ['ersatzfilter-saugroboter', 'buersten-saugroboter']],
    [/wassertank|wischpads|station/i, ['wischpads-roboter', 'entkalker']],
    [/gieß|giess|pflanze|düng|dueng/i, ['duenger', 'blumenerde']],
    [/umtopf/i, ['blumenerde', 'blumentopf']],
    [/schimmel|silikon/i, ['schimmelentferner']],
    [/edelstahl|armatur/i, ['edelstahlreiniger', 'entkalker']],
    [/sofa|couch|leder/i, ['lederpflege']],
    [/fussel|tier/i, ['muellbeutel']],
  ];
  const GENERIC = ['allzweckreiniger', 'schwaemme', 'mikrofasertuecher', 'muellbeutel', 'gummihandschuhe'];

  /** Passende Artikel zu einer Aufgabe (Katalog-Einträge), allgemeine Putzmittel als Rückfall. */
  function suggestionsFor(taskName) {
    const keys = [];
    for (const [re, list] of TASK_SUGGESTIONS) {
      if (re.test(taskName || '')) for (const k of list) if (!keys.includes(k)) keys.push(k);
    }
    for (const k of GENERIC) if (keys.length < 6 && !keys.includes(k)) keys.push(k);
    return keys.map(item).filter(Boolean);
  }

  const api = { CATEGORIES, CATALOG, category, item, findByName, search, iconFor, suggestionsFor, norm, slug };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Shopping = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

# 🧹 Putzplan

Ein automatischer Putzplan für dein Zuhause – ähnlich wie Sweepy. Die App weiß, welche Aufgabe wann fällig ist,
verteilt die Arbeit nach deinem Zeitbudget auf die Woche und sagt dir jeden Tag, was zu tun ist.

## Funktionen

- **Heute-Ansicht** – die Aufgaben für heute, mit Fortschrittsring, Abhaken, Rückgängig, Verschieben und Überspringen.
- **Putz-Timer** – Timer mit deiner Zeit starten und währenddessen abhaken. Bist du schneller, kommt eine
  Bonus-Aufgabe dazu; was bei Ablauf offen ist, wird auf morgen verschoben. Aus der Zeit zwischen zwei
  Häkchen lernt die App, wie lange du für jede Aufgabe wirklich brauchst (⏱), und plant damit.
  Im Timer kannst du Aufgaben dazunehmen (auch eigene, auf Wunsch einmalige) und per ⇄ gegen
  dringendere tauschen – die getauschte Aufgabe wandert auf morgen.
- **Saug- & Wischroboter** – einschalten, und Staubsaugen bzw. Boden wischen fallen aus dem Plan (pro Raum
  abwählbar). Dafür kommen Wartungsaufgaben wie „Staubbehälter leeren“ oder „Wassertank auffüllen“ dazu.
- **Folgeaufgaben** – z. B. nach „Wäsche aufhängen“ steht am nächsten Tag „Wäsche abnehmen“ auf dem Plan
  (wird automatisch eingerichtet; für jede Aufgabe im Bearbeiten-Dialog frei festlegbar).
- **Allergiker-Modus** – Hausstaubmilben, Pollen (nur in der Saison), Tierhaare oder Schimmel auswählen:
  Bettwäsche, Polster, Couch, Saugen & Co. werden öfter fällig (🤧), passende Zusatzaufgaben und Tipps kommen dazu.
- **Pflanzen** (eigener Tab 🪴) – gegossen wird nach Bedarf statt nach festen Terminen. Die App schätzt,
  wie schnell die Erde austrocknet, aus dem Steckbrief der Art (rund 70 Zimmer-, Balkon- und Gartenpflanzen),
  Topfgröße und -material, Licht, Jahreszeit und deiner Rückmeldung beim Gießen („noch feucht / passt / ganz
  trocken“ → Intervall ±15 % für genau diese Pflanze). Dazu Düngen (März–September) und Umtopfen (im Frühjahr).
  Wasserspeicher-Töpfe wie Lechuza: 12 Wochen Angießphase von oben, danach Speicher auffüllen, jedes vierte Mal
  zusätzlich von oben gießen. Draußen: kein Gießen nach Regen (ab 5 mm), früher bei über 28 °C, Frost-Hinweis
  unter 2 °C (Wetter von Open-Meteo, Ort in den Einstellungen). Art per Foto erkennen (Pl@ntNet).
  Pflanzenpflege zählt zum Zeitbudget, steht im Putz-Timer und bringt Punkte – oder als eigener Block unter „Heute“.
- **Einkaufsliste** (Tab 🛒) – Artikel als Kacheln wie bei Bring!, nach Supermarkt-Kategorien sortiert; ein Tipp
  hakt ab, „Zuletzt gekauft“ holt mit einem Tipp zurück. Katalog mit rund 275 Artikeln, eigene Artikel mit
  passendem Symbol, Angaben wie „2 Liter“ oder „bio“, mehrere Listen (z. B. Drogerie, Baumarkt), Zähler am Tab.
  Im Haushalt mit Konto sehen alle dieselbe Liste live, mit „wer hat's hinzugefügt“. Aus jeder Aufgabe
  („🛒 Auf die Einkaufsliste“ mit passenden Putzmitteln), bei Pflanzen (Blumenerde, Dünger) und im Timer
  („Etwas ist leer“) direkt auf die Liste.
- **Konto & gemeinsamer Haushalt** (freiwillig) – Anmeldung per E-Mail-Code oder Google. Mit Konto ist der Putzplan
  gesichert und wird zwischen den Handys aller Mitglieder abgeglichen, auch offline (Abgleich beim nächsten Netz)
  und live. Einladen per 6-stelligem Code, mehrere Haushalte (z. B. Wohnung und Ferienhaus), Mitglieder ohne
  eigenes Handy bleiben möglich. Haken zwei Personen dieselbe Aufgabe am selben Tag ab, zählt das erste Abhaken.
  Konto löschen direkt in der App. Einrichtung des Mail-Versands und der Google-Anmeldung:
  [`docs/einrichtung-konten.md`](docs/einrichtung-konten.md).
- **Automatischer Wochenplan** – Aufgaben werden nach Dringlichkeit auf die nächsten 7 Tage verteilt.
  Ist ein Tag voll, rutscht der Rest auf den nächsten Tag; bleibt Zeit übrig, werden bald fällige Aufgaben vorgezogen.
- **Zeitbudget pro Wochentag** – z. B. 20 Min. unter der Woche, 1 Std. am Samstag, Sonntag frei.
- **Räume mit Sauberkeitsanzeige** – jeder Raum zeigt, wie sauber er gerade ist; jede Aufgabe hat einen „Schmutzbalken“.
- **Vorlagen** für Küche, Bad, Wohnzimmer, Schlafzimmer, Kinderzimmer, Flur, Balkon … mit sinnvollen Intervallen.
- **Eigene Aufgaben** mit beliebigem Intervall (täglich bis jährlich oder „alle X Tage“), Dauer, Zuständigkeit und Pause-Funktion.
- **Mehrere Personen** – jede Person hat ihr eigenes Zeitbudget pro Wochentag, der Plan verteilt danach. Räume können
  einer Person gehören (z. B. Kinderzimmer → Lena): Ihre Aufgaben gehen nur an sie und warten, wenn sie keine Zeit hat.
  Feste Zuständigkeiten, freie Tage, Rangliste mit Punkten und Serie 🔥. Mit Konto zeigt „Heute“ deine Aufgaben
  (umschaltbar auf „Alle“), der Putz-Timer nimmt deine Aufgaben, und jedes Handy erinnert nur an die eigenen.
- **Tägliche Erinnerung** per Push-Benachrichtigung zur gewählten Uhrzeit – mit den Aufgaben des Tages,
  auch wenn die App geschlossen ist (Android, iPhone ab iOS 16.4 als installierte App, Desktop).
- **Als App installierbar** (PWA) – Symbol auf dem Startbildschirm, Vollbild, funktioniert offline.
- **Datenschutz** – alle Daten bleiben lokal im Browser; Export/Import als JSON für Backups oder Gerätewechsel.

## Starten

Keine Installation und kein Build-Schritt nötig – es sind nur HTML, CSS und JavaScript.

```bash
npm start            # oder: python3 -m http.server 8080
```

Dann <http://localhost:8080> öffnen. (`index.html` lässt sich auch direkt per Doppelklick öffnen;
Offline-Modus und Installation funktionieren aber nur über einen Webserver.)

Zum Veröffentlichen reicht jeder statische Hoster, z. B. **GitHub Pages**: Repository → Settings → Pages →
Branch auswählen. Danach die Seite auf dem Handy öffnen und zum Home-Bildschirm hinzufügen.

## Android-App

Im Ordner `android/` liegt eine native Android-App (Capacitor), die genau diese Web-App enthält.

- **Daten bleiben auf dem Handy**: im App-Speicher plus Sicherungsdatei im privaten Bereich der App.
  Es gibt kein Konto und keinen Server.
- **Erinnerungen** kommen als lokale Benachrichtigungen vom Handy selbst, auch offline.
  Für die nächsten 30 Tage wird jeweils der Plan des Tages eingeplant; bei jedem Öffnen wird neu geplant.
- **Installieren**: Unter *Releases* die neueste `Putzplan.apk` herunterladen, auf dem Handy öffnen und
  „Aus dieser Quelle installieren“ erlauben. Updates einfach drüberinstallieren.
- **Updates**: Die App prüft selbst, ob es eine neue Version gibt, und zeigt dann „Update verfügbar“ an –
  ein Tipp lädt sie herunter, installiert wird über die alte Version, die Daten bleiben erhalten.

### Bauen

Jeder Push baut über GitHub Actions (`.github/workflows/android.yml`) eine APK und veröffentlicht sie als Release.
Damit Updates sich drüberinstallieren lassen, braucht der Build immer denselben Signaturschlüssel –
hinterlege ihn einmalig unter *Settings → Secrets and variables → Actions*:

| Secret | Inhalt |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Keystore-Datei (`.jks`), base64-kodiert |
| `ANDROID_KEYSTORE_PASSWORD` | Passwort des Keystores (Alias `putzplan`) |

Ohne diese Secrets wird mit einem wechselnden Debug-Schlüssel signiert (installierbar, aber nicht update-fähig).

Lokal (mit Android SDK): `npm install && npm run android:sync && cd android && ./gradlew assembleRelease`.
Nach Änderungen an der Web-App immer `npm run android:sync` ausführen.

## Als Web-App aufs Handy bringen

Die App muss einmal über **HTTPS** erreichbar sein, dann lässt sie sich installieren:

1. Hosten, z. B. mit **GitHub Pages** (Settings → Pages → „Deploy from a branch“ → Branch und `/ (root)` wählen).
   Für private Repositories braucht GitHub Pages ein kostenpflichtiges GitHub-Konto; alternativ
   das Repository öffentlich machen oder den Ordner bei Netlify / Cloudflare Pages hochladen.
2. Die Adresse auf dem Handy öffnen:
   - **Android (Chrome):** Mehr → „Putzplan“ → Einstellungen → „Jetzt installieren“ bzw. Menü ⋮ → „App installieren“.
   - **iPhone (Safari):** Teilen ⬆︎ → „Zum Home-Bildschirm“.
3. Die installierte App öffnen → Mehr → **Tägliche Erinnerung** einschalten und Uhrzeit wählen.

## Erinnerungen – so funktioniert's

```
Supabase Cron (alle 5 Min.) ──► Edge Function „push“ ──► Push-Dienst (Apple/Google/Mozilla) ──► Handy
                                                                                      │
                                       Service Worker berechnet die heutigen Aufgaben ◄┘ und zeigt sie an
```

- Auf dem Server (Supabase-Projekt „Putzplan“) liegen nur die Push-Adresse des Geräts, die Uhrzeit und die
  Zeitzone – **keine Aufgaben**. Welche Aufgaben heute dran sind, berechnet das Handy selbst.
- Code: `supabase/functions/push/index.ts` (Edge Function) und `supabase/migrations/` (Tabellen + Cron-Job).
- Die Adresse der Funktion steht in `shared.js` (`PUSH_API`).

## Pflanzenerkennung per Foto

Die App schickt ein verkleinertes Foto an die Edge Function `supabase/functions/plant-id` (Adresse in `shared.js`,
`PLANT_ID_API`). Die fragt mit einem geheimen Schlüssel bei [Pl@ntNet](https://my.plantnet.org) an – der
Schlüssel steckt also nicht in der App. Fotos werden auf dem Server nicht gespeichert; auf dem Handy bleibt nur
ein kleines Vorschaubild.

Einrichten: Auf my.plantnet.org kostenlos registrieren, den API-Schlüssel kopieren und im Supabase-Dashboard
(Projekt „Putzplan“ → *Edge Functions → Secrets*) als `PLANTNET_API_KEY` speichern. Ohne Schlüssel meldet die
App „Foto-Erkennung noch nicht eingerichtet“, alles andere funktioniert normal.

## Konten & Abgleich – so funktioniert's

Ohne Konto bleibt alles wie bisher im Speicher des Geräts. Mit Konto gehört jeder Putzplan zu einem
**Haushalt** in Supabase (Tabellen `households`, `household_members`, `household_invites`, `records`;
Zugriffsregeln und Funktionen in `supabase/migrations/20261103000000_households.sql`).

- Der Zustand eines Haushalts wird in einzelne Datensätze zerlegt (jeder Raum, jede Aufgabe, jede Pflanze,
  jedes Mitglied, jeder Verlaufseintrag, die gemeinsamen Einstellungen). Hochgeladen wird nur, was sich
  geändert hat; Änderungen anderer kommen live (Supabase Realtime) oder beim nächsten Öffnen.
- Je Datensatz gilt die zuletzt gespeicherte Fassung. Persönliches (laufender Timer, Erinnerungszeit,
  „Pflanzen im Putzplan mitzählen“) bleibt auf dem Gerät.
- Die Abgleich-Regeln stehen in `sync.js` (mit Tests), die Netzwerk-Aufrufe in `cloud.js`.

## Tests

```bash
npm test
```

## So plant die App

Jede Aufgabe hat ein Intervall und ein „zuletzt erledigt“-Datum. Daraus ergibt sich die Verschmutzung:
`0` = gerade geputzt, `1` = heute fällig, `> 1` = überfällig. Für jeden Tag werden die dringendsten
Aufgaben gewählt, bis das Zeitbudget voll ist; die Simulation setzt sie dann als erledigt, sodass
wiederkehrende Aufgaben im Wochenplan korrekt erneut auftauchen. Die Logik steckt in `scheduler.js`.

Folgeaufgaben und Pflanzenpflege haben statt eines Intervalls einen festen Fälligkeitstag. Ab diesem Tag kommen sie
immer dran, auch wenn das Zeitbudget voll ist. Den Tag der Pflanzenpflege berechnet `plants.js`.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html` | Grundgerüst der App |
| `app.js` | Oberfläche, Datenhaltung (localStorage), Dialoge |
| `scheduler.js` | Planungslogik (Fälligkeit, Wochenplan, Verteilung auf Personen) |
| `sync.js`, `cloud.js` | Abgleich zwischen Geräten (Regeln) und Anbindung an Supabase (Konto, Haushalte) |
| `vendor/supabase.js` | Supabase-Client (supabase-js 2.118.0, MIT-Lizenz) |
| `docs/einrichtung-konten.md` | Anleitung: Mail-Versand (Resend) und Google-Anmeldung einrichten |
| `shopping.js` | Einkaufsliste: Katalog, Kategorien, Suche, Vorschläge zu Aufgaben |
| `plants.js` | Pflanzen: Steckbriefe, Gieß-Berechnung, Wetter, Lernen aus der Rückmeldung |
| `templates.js` | Raum- und Aufgabenvorlagen |
| `styles.css` | Design inkl. Dark Mode |
| `native.js` | Anbindung an die Android-App (lokale Erinnerungen, Sicherung, Teilen) |
| `android/`, `capacitor.config.json` | Android-Projekt |
| `shared.js` | Von App und Service Worker gemeinsam genutzt (IndexedDB, Erinnerungstext) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline-Unterstützung, Push-Empfang, Installation als App |
| `supabase/` | Server für die täglichen Erinnerungen und die Pflanzenerkennung |

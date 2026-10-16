# 🧹 Putzplan

Ein automatischer Putzplan für dein Zuhause – ähnlich wie Sweepy. Die App weiß, welche Aufgabe wann fällig ist,
verteilt die Arbeit nach deinem Zeitbudget auf die Woche und sagt dir jeden Tag, was zu tun ist.

## Funktionen

- **Heute-Ansicht** – die Aufgaben für heute, mit Fortschrittsring, Abhaken, Rückgängig, Verschieben und Überspringen.
- **Automatischer Wochenplan** – Aufgaben werden nach Dringlichkeit auf die nächsten 7 Tage verteilt.
  Ist ein Tag voll, rutscht der Rest auf den nächsten Tag; bleibt Zeit übrig, werden bald fällige Aufgaben vorgezogen.
- **Zeitbudget pro Wochentag** – z. B. 20 Min. unter der Woche, 1 Std. am Samstag, Sonntag frei.
- **Räume mit Sauberkeitsanzeige** – jeder Raum zeigt, wie sauber er gerade ist; jede Aufgabe hat einen „Schmutzbalken“.
- **Vorlagen** für Küche, Bad, Wohnzimmer, Schlafzimmer, Kinderzimmer, Flur, Balkon … mit sinnvollen Intervallen.
- **Eigene Aufgaben** mit beliebigem Intervall (täglich bis jährlich oder „alle X Tage“), Dauer, Zuständigkeit und Pause-Funktion.
- **Mehrere Personen** – faire Verteilung, feste Zuständigkeiten, freie Tage pro Person, Rangliste mit Punkten und Serie 🔥.
- **Offline & installierbar** (PWA) – auf dem Handy „Zum Home-Bildschirm hinzufügen“.
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

## Tests

```bash
npm test
```

## So plant die App

Jede Aufgabe hat ein Intervall und ein „zuletzt erledigt“-Datum. Daraus ergibt sich die Verschmutzung:
`0` = gerade geputzt, `1` = heute fällig, `> 1` = überfällig. Für jeden Tag werden die dringendsten
Aufgaben gewählt, bis das Zeitbudget voll ist; die Simulation setzt sie dann als erledigt, sodass
wiederkehrende Aufgaben im Wochenplan korrekt erneut auftauchen. Die Logik steckt in `scheduler.js`.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html` | Grundgerüst der App |
| `app.js` | Oberfläche, Datenhaltung (localStorage), Dialoge |
| `scheduler.js` | Planungslogik (Fälligkeit, Wochenplan, Verteilung auf Personen) |
| `templates.js` | Raum- und Aufgabenvorlagen |
| `styles.css` | Design inkl. Dark Mode |
| `sw.js`, `manifest.webmanifest` | Offline-Unterstützung und Installation als App |

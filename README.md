# 🧹 Putzplan

Ein automatischer Putzplan für dein Zuhause – ähnlich wie Sweepy. Die App weiß, welche Aufgabe wann fällig ist,
verteilt die Arbeit nach deinem Zeitbudget auf die Woche und sagt dir jeden Tag, was zu tun ist.

## Funktionen

- **Heute-Ansicht** – die Aufgaben für heute, mit Fortschrittsring, Abhaken, Rückgängig, Verschieben und Überspringen.
- **Putz-Timer** – Timer mit deiner Zeit starten und währenddessen abhaken. Bist du schneller, kommt eine
  Bonus-Aufgabe dazu; was bei Ablauf offen ist, wird auf morgen verschoben. Aus der Zeit zwischen zwei
  Häkchen lernt die App, wie lange du für jede Aufgabe wirklich brauchst (⏱), und plant damit.
- **Saug- & Wischroboter** – einschalten, und Staubsaugen bzw. Boden wischen fallen aus dem Plan (pro Raum
  abwählbar). Dafür kommen Wartungsaufgaben wie „Staubbehälter leeren“ oder „Wassertank auffüllen“ dazu.
- **Automatischer Wochenplan** – Aufgaben werden nach Dringlichkeit auf die nächsten 7 Tage verteilt.
  Ist ein Tag voll, rutscht der Rest auf den nächsten Tag; bleibt Zeit übrig, werden bald fällige Aufgaben vorgezogen.
- **Zeitbudget pro Wochentag** – z. B. 20 Min. unter der Woche, 1 Std. am Samstag, Sonntag frei.
- **Räume mit Sauberkeitsanzeige** – jeder Raum zeigt, wie sauber er gerade ist; jede Aufgabe hat einen „Schmutzbalken“.
- **Vorlagen** für Küche, Bad, Wohnzimmer, Schlafzimmer, Kinderzimmer, Flur, Balkon … mit sinnvollen Intervallen.
- **Eigene Aufgaben** mit beliebigem Intervall (täglich bis jährlich oder „alle X Tage“), Dauer, Zuständigkeit und Pause-Funktion.
- **Mehrere Personen** – faire Verteilung, feste Zuständigkeiten, freie Tage pro Person, Rangliste mit Punkten und Serie 🔥.
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
| `native.js` | Anbindung an die Android-App (lokale Erinnerungen, Sicherung, Teilen) |
| `android/`, `capacitor.config.json` | Android-Projekt |
| `shared.js` | Von App und Service Worker gemeinsam genutzt (IndexedDB, Erinnerungstext) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline-Unterstützung, Push-Empfang, Installation als App |
| `supabase/` | Server für die täglichen Erinnerungen |

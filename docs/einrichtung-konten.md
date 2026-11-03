# Konten einrichten: E-Mail-Versand und Google-Anmeldung

Diese Schritte machst du einmal im Supabase-Dashboard, bei Resend und in der Google Cloud Console.
Schlüssel und Passwörter trägst du nur dort ein – nie im Code oder im Chat.

Supabase-Projekt: **Putzplan** (`nqopgnogbuidqtfwpsat`) → <https://supabase.com/dashboard/project/nqopgnogbuidqtfwpsat>

## 1. E-Mails über Resend verschicken

Ohne eigenen Mail-Versand schickt Supabase Anmelde-Codes nur an die Mitglieder deines Supabase-Teams.

1. **Resend** → *API Keys* → *Create API Key*
   - Name: `Putzplan Supabase`, Berechtigung: *Sending access*, Domain: `honestcoaching.net`
   - Den Schlüssel kopieren (er wird nur einmal angezeigt).
2. **Supabase** → *Authentication* → *Emails* → Reiter *SMTP Settings* → *Enable custom SMTP*

   | Feld | Wert |
   | --- | --- |
   | Sender email | `noreply@honestcoaching.net` |
   | Sender name | `Putzplan` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | der Resend-API-Schlüssel aus Schritt 1 |

   Speichern.

Später, mit eigener Domain: in Resend die neue Domain bestätigen und hier nur die Absender-Adresse ändern.

## 2. E-Mail-Vorlage: Code statt Link

Die App fragt nach einem 6-stelligen Code. Die Standard-Mails von Supabase enthalten aber nur einen Link.

**Supabase** → *Authentication* → *Emails* → Reiter *Templates*. In beiden Vorlagen **„Magic Link“** und
**„Confirm signup“** eintragen:

- Betreff: `Dein Putzplan-Code: {{ .Token }}`
- Inhalt:

```html
<h2>Dein Code für Putzplan</h2>
<p>Gib diesen Code in der App ein:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>Der Code ist eine Stunde gültig. Wenn du dich nicht angemeldet hast, kannst du diese Mail ignorieren.</p>
```

Prüfe außerdem unter *Authentication* → *Sign In / Providers* → *Email*, dass **Email OTP Length** auf **6** steht.

## 3. Google-Anmeldung

### In der Google Cloud Console (<https://console.cloud.google.com>)

1. Oben links ein **neues Projekt** anlegen, z. B. `Putzplan`.
2. *Google Auth Platform* (früher „OAuth-Zustimmungsbildschirm“) → *Erste Schritte*:
   - App-Name `Putzplan`, deine Support-E-Mail
   - Zielgruppe: **Extern**
   - Kontaktdaten: deine E-Mail → Zustimmen → Erstellen
   - Solange die App im Modus „Test“ ist, können sich nur eingetragene **Testnutzer** anmelden
     (*Zielgruppe* → *Testnutzer hinzufügen*). Vor dem Store-Start auf **„Veröffentlichen“** stellen.
3. *Clients* → *Client erstellen* → Typ **Webanwendung**:
   - Name: `Putzplan Web`
   - Autorisierte Weiterleitungs-URIs: `https://nqopgnogbuidqtfwpsat.supabase.co/auth/v1/callback`
   - Erstellen → **Client-ID** und **Clientschlüssel** kopieren.
4. *Clients* → *Client erstellen* → Typ **Android**:
   - Paketname: `de.putzplan.app`
   - SHA-1-Fingerabdruck deines Signaturschlüssels. Auf einem Rechner mit Java, im Ordner deiner `.jks`-Datei:

     ```bash
     keytool -list -v -keystore putzplan.jks -alias putzplan
     ```

     Die Zeile `SHA1: …` kopieren. Es muss der Schlüssel sein, mit dem GitHub Actions die APK signiert
     (Secret `ANDROID_KEYSTORE_BASE64`). Für den Play Store kommt später ein zweiter Android-Client mit dem
     SHA-1 der Google-Play-App-Signatur dazu.

### In Supabase

*Authentication* → *Sign In / Providers* → **Google** → aktivieren:

- *Client IDs*: die **Web**-Client-ID aus Schritt 3
- *Client Secret*: der Clientschlüssel aus Schritt 3
- Speichern.

### In der App

Die **Web-Client-ID** (endet auf `.apps.googleusercontent.com`) ist nicht geheim. Sie kommt in `shared.js`
(`GOOGLE_WEB_CLIENT_ID`). Schick sie mir, dann trage ich sie ein. Bis dahin zeigt der Google-Knopf
„wird gerade eingerichtet“, die Anmeldung per E-Mail funktioniert schon.

// Putzplan – Push-Erinnerungen
//
//   GET  /push/config       → öffentlicher VAPID-Schlüssel für pushManager.subscribe()
//   POST /push/subscribe    → { subscription, time: "HH:MM", timezone } speichern/aktualisieren
//   POST /push/unsubscribe  → { endpoint } löschen
//   POST /push/test         → { endpoint } sofort eine Testbenachrichtigung schicken
//   POST /push/send         → vom Cron-Job alle 5 Minuten aufgerufen (Header x-cron-secret)
//
// Auf dem Server liegen nur die Push-Adressen und Uhrzeiten, keine Aufgaben.
// Welche Aufgaben heute dran sind, berechnet der Service Worker auf dem Gerät.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const SUBJECT = 'https://github.com/daviddistl-boop/Putzplan';
// Nur echte Push-Dienste der Browser-Hersteller sind als Ziel erlaubt.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^(.+\.)?push\.apple\.com$/,
  /^(.+\.)?notify\.windows\.com$/,
  /^(.+\.)?push\.services\.mozilla\.com$/,
];
// Erinnerung wird höchstens so lange nach der gewünschten Uhrzeit noch verschickt.
const SEND_WINDOW_MIN = 60;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

type Config = { vapid_public: string; vapid_private: string; cron_secret: string };
let cached: Config | null = null;

async function readConfig() {
  const { data, error } = await db.from('push_config').select('*').eq('id', 1).single();
  if (error) throw error;
  return data as Config;
}

async function getConfig(): Promise<Config> {
  if (cached) return cached;
  let cfg = await readConfig();
  if (!cfg.vapid_public || !cfg.vapid_private) {
    // Beim ersten Aufruf Schlüssel erzeugen – nur setzen, falls noch keine da sind.
    const keys = webpush.generateVAPIDKeys();
    const { error } = await db.from('push_config')
      .update({ vapid_public: keys.publicKey, vapid_private: keys.privateKey })
      .eq('id', 1).is('vapid_public', null);
    if (error) throw error;
    cfg = await readConfig();
  }
  webpush.setVapidDetails(SUBJECT, cfg.vapid_public, cfg.vapid_private);
  return (cached = cfg);
}

function validEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

function validTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('de', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function localNow(tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: +parts.hour * 60 + +parts.minute };
}

const toMinutes = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);

type Sub = { endpoint: string; p256dh: string; auth: string; reminder_time: string; timezone: string; last_sent_date: string | null };

async function push(sub: Sub, payload: Record<string, unknown>) {
  await getConfig();
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 4 * 3600, urgency: 'normal' },
    );
    return { ok: true, status: 201 };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode ?? 0;
    // Abo abgelaufen oder vom Nutzer entzogen → aufräumen.
    if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    return { ok: false, status, error: String((e as Error).message ?? e) };
  }
}

const DAILY = { type: 'daily', title: 'Putzplan', body: 'Schau nach, was heute zu tun ist 🧽' };

async function sendDue() {
  const { data, error } = await db.from('push_subscriptions').select('*');
  if (error) throw error;
  let sent = 0, failed = 0;
  for (const sub of (data ?? []) as Sub[]) {
    const now = localNow(sub.timezone);
    const start = toMinutes(sub.reminder_time);
    if (sub.last_sent_date === now.date || now.minutes < start || now.minutes >= start + SEND_WINDOW_MIN) continue;
    const res = await push(sub, DAILY);
    if (res.ok) {
      sent++;
      await db.from('push_subscriptions').update({ last_sent_date: now.date }).eq('endpoint', sub.endpoint);
    } else {
      failed++;
      console.error('Push fehlgeschlagen', res.status, res.error);
    }
  }
  return { sent, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const route = new URL(req.url).pathname.split('/').filter(Boolean).pop();

  try {
    if (route === 'config' && req.method === 'GET') {
      const cfg = await getConfig();
      return json({ publicKey: cfg.vapid_public });
    }

    if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
    const body = await req.json().catch(() => ({}));

    if (route === 'subscribe') {
      const sub = body.subscription ?? {};
      const time = typeof body.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time) ? body.time : null;
      if (!validEndpoint(sub.endpoint) || typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string' || !time || !validTimezone(body.timezone)) {
        return json({ error: 'Ungültige Anmeldung' }, 400);
      }
      // Liegt die Uhrzeit heute schon zurück, gilt der heutige Tag als erledigt.
      const now = localNow(body.timezone);
      const lastSent = now.minutes >= toMinutes(time) ? now.date : null;
      const { error } = await db.from('push_subscriptions').upsert({
        endpoint: sub.endpoint, p256dh: sub.keys.p256dh.slice(0, 200), auth: sub.keys.auth.slice(0, 100),
        reminder_time: time, timezone: body.timezone, last_sent_date: lastSent, updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return json({ ok: true });
    }

    if (route === 'unsubscribe') {
      if (!validEndpoint(body.endpoint)) return json({ error: 'Ungültig' }, 400);
      await db.from('push_subscriptions').delete().eq('endpoint', body.endpoint);
      return json({ ok: true });
    }

    if (route === 'test') {
      if (!validEndpoint(body.endpoint)) return json({ error: 'Ungültig' }, 400);
      const { data } = await db.from('push_subscriptions').select('*').eq('endpoint', body.endpoint).maybeSingle();
      if (!data) return json({ error: 'Gerät ist nicht angemeldet' }, 404);
      const res = await push(data as Sub, { ...DAILY, test: true });
      return json(res, res.ok ? 200 : 502);
    }

    if (route === 'send') {
      const cfg = await getConfig();
      if (req.headers.get('x-cron-secret') !== cfg.cron_secret) return json({ error: 'Forbidden' }, 403);
      return json(await sendDue());
    }

    return json({ error: 'Not found' }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: 'Serverfehler' }, 500);
  }
});

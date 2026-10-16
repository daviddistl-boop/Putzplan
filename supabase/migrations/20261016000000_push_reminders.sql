-- Putzplan: Push-Erinnerungen (so im Supabase-Projekt "Putzplan" angewendet)
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists pgcrypto with schema extensions;

-- Konfiguration: VAPID-Schlüssel (von der Edge Function erzeugt) und Cron-Geheimnis.
create table public.push_config (
  id int primary key default 1 check (id = 1),
  vapid_public text,
  vapid_private text,
  cron_secret text not null default encode(extensions.gen_random_bytes(32), 'hex')
);
insert into public.push_config (id) values (1);

-- Ein Eintrag pro Gerät, das Erinnerungen bekommen möchte. Keine Aufgabendaten.
create table public.push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  reminder_time text not null default '08:00' check (reminder_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone text not null default 'Europe/Berlin',
  last_sent_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Nur die Edge Function (service_role) greift zu.
alter table public.push_config enable row level security;
alter table public.push_subscriptions enable row level security;
revoke all on public.push_config from anon, authenticated;
revoke all on public.push_subscriptions from anon, authenticated;

-- Alle 5 Minuten prüfen, wer gerade erinnert werden soll.
-- (Projekt-URL ggf. anpassen, wenn du ein eigenes Supabase-Projekt verwendest.)
select cron.schedule(
  'putzplan-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://nqopgnogbuidqtfwpsat.supabase.co/functions/v1/push/send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select cron_secret from public.push_config where id = 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

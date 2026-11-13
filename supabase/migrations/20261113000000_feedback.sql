-- Putzplan: Feedback, Anregungen und Fehlermeldungen aus der App.
-- Jeder (auch ohne Konto) darf eine Meldung EINSENDEN; lesen kann sie nur der
-- Projektinhaber im Supabase-Dashboard (Table Editor → feedback).

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('idea', 'bug', 'feedback')),
  message text not null check (char_length(message) between 3 and 2000),
  contact text check (contact is null or char_length(contact) <= 200),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  platform text check (platform is null or char_length(platform) <= 40),
  context jsonb check (context is null or pg_column_size(context) <= 4000),
  -- Angemeldete Nutzer: automatisch ihr Konto, nicht fälschbar (Spalte nicht beschreibbar).
  user_id uuid default auth.uid(),
  status text not null default 'neu' check (status in ('neu', 'in Arbeit', 'erledigt', 'verworfen'))
);

create index if not exists feedback_created_at_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;

-- Nur Einsenden, nur die Inhaltsspalten. Kein Lesen, Ändern oder Löschen über die App.
revoke all on public.feedback from anon, authenticated;
grant insert (kind, message, contact, app_version, platform, context) on public.feedback to anon, authenticated;

drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback
  for insert to anon, authenticated
  with check (status = 'neu' and (user_id is null or user_id = auth.uid()));

-- Schutz vor Überflutung: höchstens 60 Meldungen pro 10 Minuten insgesamt.
create or replace function public.feedback_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.feedback where created_at > now() - interval '10 minutes') >= 60 then
    raise exception 'too_many_feedback' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.feedback_rate_limit() from public, anon, authenticated;

drop trigger if exists feedback_rate_limit on public.feedback;
create trigger feedback_rate_limit
  before insert on public.feedback
  for each row execute function public.feedback_rate_limit();

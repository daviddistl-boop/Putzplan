-- Putzplan – Konten, Haushalte und Abgleich
--
-- Ein Konto (auth.users) kann zu mehreren Haushalten gehören. Alle Daten eines Haushalts
-- (Räume, Aufgaben, Pflanzen, Mitglieder, Verlauf, Einstellungen, Einkaufslisten …) liegen als
-- einzelne Datensätze in `records` (Art + ID + JSON). Die App gleicht sie ab: Jeder Datensatz
-- gilt in der zuletzt gespeicherten Fassung; gelöschte bleiben als Grabstein (deleted) stehen,
-- damit andere Geräte das Löschen mitbekommen.

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  icon text not null default '🏠' check (char_length(icon) <= 16),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  member_id text check (char_length(member_id) <= 64),          -- verknüpftes Mitglied im Team
  display_name text check (char_length(display_name) <= 60),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user on public.household_members (user_id);

create table public.household_invites (
  code text primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null
);
create index household_invites_household on public.household_invites (household_id);

-- Fehlversuche beim Beitreten (gegen Durchprobieren der Codes).
create table public.household_join_failures (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index household_join_failures_user on public.household_join_failures (user_id, at);

create table public.records (
  household_id uuid not null references public.households (id) on delete cascade,
  kind text not null check (char_length(kind) <= 32),
  id text not null check (char_length(id) <= 80),
  data jsonb check (data is null or octet_length(data::text) < 300000),
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (household_id, kind, id)
);
create index records_household_updated on public.records (household_id, updated_at);

-- Zeitstempel und Absender setzt immer der Server (die App holt Änderungen „seit Zeitpunkt X“).
create function public.records_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger records_touch before insert or update on public.records
  for each row execute function public.records_touch();

-- ------------------------------------------------------------------ Zugriffsregeln

create function public.is_member(h uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members m where m.household_id = h and m.user_id = auth.uid());
$$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.household_join_failures enable row level security;
alter table public.records enable row level security;

create policy "Mitglieder sehen ihren Haushalt" on public.households
  for select to authenticated using (public.is_member(id));
create policy "Mitglieder benennen ihren Haushalt um" on public.households
  for update to authenticated using (public.is_member(id)) with check (public.is_member(id));

create policy "Mitglieder sehen die Mitglieder" on public.household_members
  for select to authenticated using (public.is_member(household_id));
create policy "Eigene Mitgliedschaft bearbeiten" on public.household_members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Mitglieder lesen Datensätze" on public.records
  for select to authenticated using (public.is_member(household_id));
create policy "Mitglieder legen Datensätze an" on public.records
  for insert to authenticated with check (public.is_member(household_id));
create policy "Mitglieder ändern Datensätze" on public.records
  for update to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));

-- Rolle und Haushalt der eigenen Mitgliedschaft lassen sich nicht direkt ändern.
revoke all on public.household_members from anon, authenticated;
grant select on public.household_members to authenticated;
grant update (member_id, display_name) on public.household_members to authenticated;
revoke all on public.households from anon;
revoke insert, delete on public.households from authenticated;
revoke all on public.records from anon;
revoke delete on public.records from authenticated;
revoke all on public.household_invites from anon, authenticated;
revoke all on public.household_join_failures from anon, authenticated;

-- ------------------------------------------------------------------ Funktionen

create function public.create_household(p_name text, p_icon text, p_member_id text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  insert into public.households (name, icon) values (p_name, coalesce(nullif(p_icon, ''), '🏠')) returning id into h;
  insert into public.household_members (household_id, user_id, role, member_id, display_name)
    values (h, auth.uid(), 'owner', p_member_id, p_display_name);
  return h;
end $$;

create function public.create_invite(p_household uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if not public.is_member(p_household) then raise exception 'not_member'; end if;
  delete from public.household_invites where expires_at < now();
  loop
    c := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.household_invites where code = c);
  end loop;
  insert into public.household_invites (code, household_id, created_by, expires_at)
    values (c, p_household, auth.uid(), now() + interval '7 days');
  return c;
end $$;

create function public.join_household(p_code text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if (select count(*) from public.household_join_failures f
      where f.user_id = auth.uid() and f.at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_attempts';
  end if;
  select i.household_id into h from public.household_invites i
    where i.code = trim(p_code) and i.expires_at > now();
  if h is null then
    insert into public.household_join_failures (user_id) values (auth.uid());
    raise exception 'invalid_code';
  end if;
  insert into public.household_members (household_id, user_id, role, display_name)
    values (h, auth.uid(), 'member', p_display_name)
    on conflict (household_id, user_id) do nothing;
  return h;
end $$;

-- Verlassen: Wer den Haushalt angelegt hat, gibt die Rechte an das am längsten dabei gewesene
-- Mitglied weiter. Ist danach niemand mehr da, wird der Haushalt gelöscht.
create function public.leave_household_for(p_household uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare was_owner boolean; next_user uuid;
begin
  delete from public.household_members where household_id = p_household and user_id = p_user
    returning role = 'owner' into was_owner;
  select m.user_id into next_user from public.household_members m
    where m.household_id = p_household order by m.joined_at, m.user_id limit 1;
  if next_user is null then
    delete from public.households where id = p_household;
  elsif was_owner and not exists (select 1 from public.household_members m where m.household_id = p_household and m.role = 'owner') then
    update public.household_members set role = 'owner' where household_id = p_household and user_id = next_user;
  end if;
end $$;
revoke execute on function public.leave_household_for(uuid, uuid) from public, anon, authenticated;

create function public.leave_household(p_household uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(p_household) then raise exception 'not_member'; end if;
  perform public.leave_household_for(p_household, auth.uid());
end $$;

create function public.remove_member(p_household uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.household_members m
                 where m.household_id = p_household and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'not_owner';
  end if;
  if p_user = auth.uid() then raise exception 'use_leave'; end if;
  perform public.leave_household_for(p_household, p_user);
end $$;

create function public.delete_household(p_household uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.household_members m
                 where m.household_id = p_household and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'not_owner';
  end if;
  delete from public.households where id = p_household;
end $$;

-- Konto löschen (Pflicht in beiden App-Stores): alle Haushalte verlassen, dann das Konto entfernen.
create function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
declare h uuid; me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  for h in select household_id from public.household_members where user_id = me loop
    perform public.leave_household_for(h, me);
  end loop;
  delete from auth.users where id = me;
end $$;

revoke execute on function public.create_household(text, text, text, text) from public, anon;
revoke execute on function public.create_invite(uuid) from public, anon;
revoke execute on function public.join_household(text, text) from public, anon;
revoke execute on function public.leave_household(uuid) from public, anon;
revoke execute on function public.remove_member(uuid, uuid) from public, anon;
revoke execute on function public.delete_household(uuid) from public, anon;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.create_household(text, text, text, text) to authenticated;
grant execute on function public.create_invite(uuid) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;
grant execute on function public.leave_household(uuid) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.delete_household(uuid) to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- Live-Abgleich: Änderungen an Datensätzen und Mitgliedern an die Geräte schicken.
alter publication supabase_realtime add table public.records;
alter publication supabase_realtime add table public.household_members;

revoke execute on function public.is_member(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;

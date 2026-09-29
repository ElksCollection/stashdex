-- Punt 20: instellingen per gebruiker (mee naar elk apparaat) en "Account verwijderen".
-- Uitvoeren in Supabase: SQL Editor → New query → plakken → Run. Veilig om opnieuw uit te voeren.

-- Instellingen: één rij per gebruiker, alle keuzes samen in één JSON-veld
create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
drop policy if exists "eigen instellingen" on public.user_settings;
create policy "eigen instellingen" on public.user_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
revoke all on public.user_settings from anon;
grant select, insert, update, delete on public.user_settings to authenticated;

-- Account verwijderen: wist de ingelogde gebruiker zelf (en niemand anders).
-- Collectie, wensenlijst en instellingen gaan mee via "on delete cascade".
-- "security definer" = draait met de rechten van de eigenaar, zodat hij in auth.users mag;
-- de functie kan alleen de eigen rij (auth.uid()) raken, dus geen geheime sleutel nodig.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Niet ingelogd';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Controle: moet 'user_settings' en 'delete_my_account' tonen
select 'user_settings' as onderdeel, count(*) as rijen from public.user_settings
union all
select 'delete_my_account', count(*) from pg_proc where proname = 'delete_my_account';

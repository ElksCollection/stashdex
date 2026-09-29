-- Tabellen voor Stashdex: collectie en wensenlijst per gebruiker.
-- Uitvoeren in Supabase: SQL Editor → New query → plakken → Run.
-- Veilig om opnieuw uit te voeren.

-- Collectie: welke kaarten iemand heeft, hoeveel, en eventueel een eigen waarde
create table if not exists public.collection (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id text not null,                       -- kaart-id van TCGdex, bv. 'sv03.5-006'
  count integer not null default 1 check (count > 0),
  raw_value_usd numeric,                       -- niet meer in gebruik: geen eigen waardes (besluit 28-09-2026)
  graded_value_usd numeric,                    -- niet in gebruik
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

-- Wensenlijst: kaarten die iemand nog wil hebben
create table if not exists public.wishlist (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

-- Beveiliging (RLS): iedereen ziet en wijzigt alleen zijn eigen rijen
alter table public.collection enable row level security;
alter table public.wishlist enable row level security;

drop policy if exists "eigen collectie" on public.collection;
create policy "eigen collectie" on public.collection
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "eigen wensenlijst" on public.wishlist;
create policy "eigen wensenlijst" on public.wishlist
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Niet-ingelogde bezoekers krijgen geen enkele toegang
revoke all on public.collection from anon;
revoke all on public.wishlist from anon;
grant select, insert, update, delete on public.collection to authenticated;
grant select, insert, update, delete on public.wishlist to authenticated;

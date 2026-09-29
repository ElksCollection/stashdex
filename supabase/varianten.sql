-- Punt 21: normaal en reverse holo als aparte kaarten in je collectie en wensenlijst.
-- Uitvoeren in Supabase: SQL Editor → New query → plakken → Run.
-- Alles wat je al hebt, wordt automatisch 'normal'. Veilig om opnieuw uit te voeren.
-- Later kunnen er versies bij (bv. 'holo', 'firstEdition'): dan alleen de check uitbreiden.

alter table public.collection add column if not exists variant text not null default 'normal';
alter table public.collection drop constraint if exists collection_variant_check;
alter table public.collection add constraint collection_variant_check check (variant in ('normal', 'reverse'));
alter table public.collection drop constraint if exists collection_pkey;
alter table public.collection add primary key (user_id, card_id, variant);

alter table public.wishlist add column if not exists variant text not null default 'normal';
alter table public.wishlist drop constraint if exists wishlist_variant_check;
alter table public.wishlist add constraint wishlist_variant_check check (variant in ('normal', 'reverse'));
alter table public.wishlist drop constraint if exists wishlist_pkey;
alter table public.wishlist add primary key (user_id, card_id, variant);

-- Controle: dit moet je hele collectie tonen, alles met variant 'normal'
select variant, count(*) as kaarten, sum(count) as exemplaren from public.collection group by variant;

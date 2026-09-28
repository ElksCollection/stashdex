-- Wist de oude "eigen waardes" (PriceCharting, 22-09-2026) van de overgezette kaarten,
-- zodat Stashdex overal de actuele Cardmarket-marktprijs gebruikt (keuze Thimo, 28-09-2026).
-- Uitvoeren in Supabase: SQL Editor → New query → alles plakken → Run.
-- Aantallen blijven gewoon staan; alleen de eigen waarde wordt leeggemaakt.

update public.collection
set raw_value_usd = null, updated_at = now()
where card_id like '30th-%' and raw_value_usd is not null;

-- Controle: hier moet 0 uitkomen
select count(*) as kaarten_met_eigen_waarde from public.collection
where card_id like '30th-%' and raw_value_usd is not null;

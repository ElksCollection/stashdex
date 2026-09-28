-- Zet de kaart-id's in de collectie om van pokemontcg.io naar TCGdex (28-09-2026).
-- Uitvoeren in Supabase: SQL Editor → New query → alles plakken → Run.
-- Veilig: de oude rijen blijven staan (die ziet de nieuwe site gewoon niet) en
-- opnieuw uitvoeren kan geen kwaad. Aantal en eigen waarde worden meegekopieerd.
-- Alle 31 koppelingen zijn op naam gecontroleerd.

insert into public.collection (user_id, card_id, count, raw_value_usd, graded_value_usd, created_at, updated_at)
select c.user_id, m.new_id, c.count, c.raw_value_usd, c.graded_value_usd, c.created_at, now()
from public.collection c
join (values
  ('me55-1', '30th-001'),
  ('me55-2', '30th-002'),
  ('me55-3', '30th-003'),
  ('me55-5', '30th-005'),
  ('me55-9', '30th-009'),
  ('me55-10', '30th-010'),
  ('me55-12', '30th-012'),
  ('me55-15', '30th-015'),
  ('me55-19', '30th-019'),
  ('me55-60', '30th-060'),
  ('me55-61', '30th-061'),
  ('me55-64', '30th-064'),
  ('me55-77', '30th-077'),
  ('me55-79', '30th-079'),
  ('me55-86', '30th-086'),
  ('me55-90', '30th-090'),
  ('me55-91', '30th-091'),
  ('me55-92', '30th-092'),
  ('me55-93', '30th-093'),
  ('me55-106', '30th-106'),
  ('me55-114', '30th-114'),
  ('me55-115', '30th-115'),
  ('me55-116', '30th-116'),
  ('me55-121', '30th-121'),
  ('me55-127', '30th-127'),
  ('me55-138', '30th-138'),
  ('me55-145', '30th-145'),
  ('me55-154', '30th-154'),
  ('me55-155', '30th-155'),
  ('me55c-4', '30th-c-001'),
  ('me55c-108', '30th-c-025')
) as m(old_id, new_id) on m.old_id = c.card_id
on conflict (user_id, card_id) do nothing;

-- Controle: hier moet 31 uitkomen
select count(*) as kaarten_met_nieuwe_id from public.collection
where card_id like '30th-%';

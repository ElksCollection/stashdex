-- Opruimen na de overstap naar TCGdex (30-09-2026): de oude kaart-id's (me55-…)
-- stonden nog naast de nieuwe (30th-…). De site gebruikt alleen de nieuwe.
-- Uitvoeren in Supabase: SQL Editor → New query → alles plakken → Run.
-- Veilig: een oude rij wordt alleen gewist als de nieuwe versie van dezelfde
-- kaart er ook staat. Opnieuw uitvoeren kan geen kwaad.

delete from public.collection oud
using (values
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
) as m(old_id, new_id)
where oud.card_id = m.old_id
  and exists (
    select 1 from public.collection nieuw
    where nieuw.user_id = oud.user_id and nieuw.card_id = m.new_id
  );

-- Controle: hier moet oud = 0 uitkomen (nieuw = 31, of meer als je sindsdien kaarten hebt toegevoegd)
select
  count(*) filter (where card_id like 'me55%') as oud,
  count(*) filter (where card_id like '30th-%') as nieuw
from public.collection;

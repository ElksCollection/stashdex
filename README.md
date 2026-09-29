# Stashdex

Persoonlijke website om een Pokémon-kaartencollectie bij te houden: alle sets
en kaarten met actuele prijzen, eigen collectie en wensenlijst.

- Live: https://elkscollection.github.io/stashdex/
- Website: GitHub Pages (statische HTML/CSS/JavaScript).
- Kaartdata: TCGdex (gratis, open source); prijzen: het gratis prijzenbestand
  van Cardmarket (euro's). Elke nacht automatisch bijgewerkt.
- Collectie en wensenlijst: Supabase, met login.

## Opbouw van de code
- `index.html`: inlogschermen en een lege plek voor de app.
- `css/design-system.css`: het ontwerpsysteem (kopie van het Kaartenkluis-
  ontwerp uit Claude Design; klassen beginnen met `kk-`).
- `css/app.css`: kleuren en de indeling van deze app.
- `js/supabase-client.js`: verbinding met Supabase ("Onthoud mij", foutmeldingen).
- `js/auth.js`: inloggen, wachtwoord vergeten, nieuw wachtwoord.
- `js/app.js`: de app zelf (menubalk, setpaneel, kaarten, kaartdetail).
- `js/rarity.js`: zeldzaamheidsladder (acht niveaus) en kaarttypes.
- `supabase/schema.sql`: tabellen en beveiliging in Supabase (nieuwe database).
- `supabase/varianten.sql`: kolom `variant` (normaal / reverse holo) voor een bestaande database.

## Kaartdata
Normaal en reverse holo zijn in Stashdex aparte kaarten, elk met een eigen
aantal en prijs (`eur` en `eurRev`; in Supabase de kolom `variant`).

Vier scripts in `scripts/` (Python, geen extra pakketten nodig):
- `update_catalog.py` — kaartgegevens van TCGdex (api.tcgdex.net) naar
  `data/catalog/`. Niet elke nacht alles: nieuwe en recente sets wel, oudere
  sets om de 30 dagen (een paar per nacht). Mislukt een set, dan wordt die de
  volgende nacht opnieuw geprobeerd. TCG Pocket (digitaal spel) doet niet mee.
- `update_prices.py` — het prijzenbestand van Cardmarket (alle Pokémon-
  producten) naar een momentopname per dag: `data/prices/<datum>.json`
  (trendprijs en trendprijs reverse holo, in euro's). Samen vormen die de
  prijsgeschiedenis.
- `update_rates.py` — de dollarkoers van de ECB naar `data/prices/koers.json`.
- `build_site_data.py` — maakt zonder internet de bestanden die de website
  laadt: `data/sets.json`, `data/cards/<set-id>.json`,
  `data/history/<set-id>.json` (grafieken) en `data/meta.json`. Deze staan
  niet in git; ze worden bij elke publicatie opnieuw gemaakt.

`.github/workflows/deploy.yml` draait dit elke nacht (03:00 UTC) en zet de
website online (alleen de websitebestanden, via de map `_site`). Handmatig
starten: tabblad Actions op GitHub → "Run workflow". Als een bron niet
bereikbaar was, gaat de site gewoon online met de laatst bekende gegevens en
staat de run op "mislukt" (GitHub stuurt dan een mail).

Lokaal testen: `python scripts/update_catalog.py 30th` (alleen die set),
`python scripts/update_prices.py`, `python scripts/build_site_data.py`, en dan
de map openen via een lokale webserver (`python -m http.server`).

## Gebruik
Open het webadres hierboven in de browser op laptop of telefoon.

## Werkwijze met branches
- Bouwen gebeurt op de branch **`werk`**; na elke afgeronde stap committen en
  pushen. Daar gaat niets van live.
- Alleen **`main`** wordt gepubliceerd (en daar slaat de nachtelijke ronde de
  kaartdata en prijzen op).
- Is een stap af en getest op laptop én telefoon: eerst `main` in `werk`
  samenvoegen (`git merge origin/main`), daarna `main` bijwerken met
  `git switch main && git merge --ff-only werk && git push` en terug naar
  `werk`. Binnen ongeveer een minuut staat het live.

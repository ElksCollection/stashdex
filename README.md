# Stashdex

Persoonlijke website om een Pokémon-kaartencollectie bij te houden: alle sets
en kaarten met actuele prijzen, eigen collectie en wensenlijst.

- Live: https://elkscollection.github.io/stashdex/
- Website: GitHub Pages (statische HTML/CSS/JavaScript).
- Kaartdata en prijzen: pokemontcg.io (wordt later elke nacht automatisch opgehaald).
- Collectie en wensenlijst: Supabase, met login.

## Kaartdata
- `scripts/fetch_cards.py` haalt alle sets en kaarten op en schrijft:
  - `data/sets.json`: alle sets (naam, serie, aantal kaarten, logo).
  - `data/cards/<set-id>.json`: kaarten per set met plaatje, zeldzaamheid,
    type en prijs (`usd` = TCGPlayer-marktprijs, actueel; `eur` =
    Cardmarket-trendprijs, loopt achter bij de bron).
  - `data/meta.json`: moment van laatste update en eventueel mislukte sets.
- `.github/workflows/deploy.yml` draait dit elke nacht (03:00 UTC) en zet de
  website online. Handmatig starten: tabblad Actions op GitHub → "Run workflow".
- Lokaal testen: `python scripts/fetch_cards.py sv1` (alleen set sv1).

## Gebruik
Open het webadres hierboven in de browser op laptop of telefoon.
Wijzigingen in deze map worden via GitHub automatisch binnen ongeveer een
minuut live gezet.

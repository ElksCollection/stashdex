# Stashdex

Persoonlijke website om een Pokémon-kaartencollectie bij te houden: alle sets
en kaarten met actuele prijzen, eigen collectie en wensenlijst.

- Live: https://elkscollection.github.io/stashdex/
- Website: GitHub Pages (statische HTML/CSS/JavaScript).
- Kaartdata en prijzen: pokemontcg.io (elke nacht automatisch opgehaald).
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
- `supabase/schema.sql`: tabellen en beveiliging in Supabase.

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

"""Haalt de prijzen van vandaag op uit het gratis prijzenbestand van Cardmarket.

Cardmarket zet elke nacht één bestand online met de prijzen van alle
Pokémon-producten (game 6). Wij bewaren daaruit alleen de kaarten uit onze
catalogus, als momentopname per dag: data/prices/<datum>.json.
Samen vormen die momentopnames de prijsgeschiedenis voor de grafieken.

Per product: [trendprijs, trendprijs reverse holo] in euro's (null = onbekend).
"""

import json
import sys

from common import CATALOG, PRICES, fetch, read_json, write_json

PRICE_GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json"


def price(value):
    """Cardmarket gebruikt 0 of null voor "geen prijs"; wij alleen null."""
    return round(value, 2) if isinstance(value, (int, float)) and value > 0 else None


def main():
    # Welke producten we nodig hebben: het Cardmarket-nummer van elke kaart in de catalogus
    wanted = set()
    for path in (CATALOG / "cards").glob("*.json"):
        wanted.update(c["cm"] for c in read_json(path, []) if c.get("cm"))
    if not wanted:
        sys.exit("Catalogus is leeg; draai eerst update_catalog.py")

    print("Prijzenbestand van Cardmarket ophalen ...", flush=True)
    try:
        guide = json.loads(fetch(PRICE_GUIDE, timeout=180))
    except (RuntimeError, json.JSONDecodeError) as err:
        # Geen nieuwe prijzen vandaag; de site blijft de laatste bekende prijzen tonen
        sys.exit(f"Prijzen ophalen mislukt: {err}")

    # De datum van het bestand zelf, zodat een dubbele run geen extra dag maakt
    day = str(guide.get("createdAt", ""))[:10]
    if len(day) != 10:
        sys.exit(f"Onverwachte datum in het prijzenbestand: {guide.get('createdAt')!r}")

    prices = {}
    for row in guide.get("priceGuides") or []:
        pid = row.get("idProduct")
        if pid in wanted:
            trend, rev = price(row.get("trend")), price(row.get("trend-holo"))
            if trend or rev:
                prices[str(pid)] = [trend, rev]

    # Controle: als bijna niets gevonden wordt, is er iets mis met het bestand; dan niet opslaan
    if len(prices) < len(wanted) * 0.5:
        sys.exit(f"Maar {len(prices)} van {len(wanted)} kaarten gevonden in het prijzenbestand; niet opgeslagen")

    write_json(PRICES / f"{day}.json", {"date": day, "source": "cardmarket", "prices": prices})
    print(f"Klaar: prijzen van {day} voor {len(prices)} van {len(wanted)} kaarten opgeslagen", flush=True)


if __name__ == "__main__":
    main()

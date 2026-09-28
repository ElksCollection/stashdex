"""Werkt de kaartcatalogus bij vanuit TCGdex (gratis, open source: tcgdex.dev).

Kaartgegevens veranderen bijna nooit, dus niet elke nacht alles ophalen:
- nieuwe sets en sets waarvan het aantal kaarten veranderde: meteen;
- recente sets (laatste 90 dagen): elke nacht, want daar komen nog correcties;
- oudere sets: om de 30 dagen, een paar per nacht (rouleren);
- een set die mislukt, blijft "te doen" en wordt de volgende nacht opnieuw geprobeerd.

Schrijft data/catalog/sets.json en data/catalog/cards/<set-id>.json.

Gebruik:
    python scripts/update_catalog.py            # normale nachtelijke ronde
    python scripts/update_catalog.py sv01 30th  # alleen deze sets (opnieuw) ophalen
"""

import re
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

from common import CATALOG, fetch_json, read_json, write_json

API = "https://api.tcgdex.net/v2/en"
ASSETS = "https://assets.tcgdex.net/"
SKIP_SERIES = {"tcgp"}          # TCG Pocket is het digitale spel, geen echte kaarten
RECENT_DAYS = 90                # sets jonger dan dit: elke nacht controleren
RECHECK_DAYS = 30               # oudere sets: om de zoveel dagen opnieuw controleren
ROLL_PER_NIGHT = 12             # maximaal zoveel oudere sets per nacht
THREADS = 4                     # gelijktijdige verzoeken; bewust bescheiden voor de gratis bron
SAFE_ID = re.compile(r"^[A-Za-z0-9.\-]+$")  # set-id's worden bestandsnamen, dus alleen veilige tekens


def api(path):
    return fetch_json(f"{API}/{urllib.parse.quote(path)}")


def asset(url):
    """Alleen plaatjes van TCGdex zelf accepteren."""
    return url if isinstance(url, str) and url.startswith(ASSETS) else None


def main_product(card):
    """Het Cardmarket-productnummer van de gewone versie van de kaart (voor de prijs)."""
    cm = ((card.get("pricing") or {}).get("cardmarket") or {}).get("idProduct")
    if cm:
        return cm
    variants = card.get("variants_detailed") or []
    # Liefst een versie zonder stempel (zoals "1st edition")
    for v in sorted(variants, key=lambda v: bool(v.get("stamp"))):
        cm = (v.get("thirdParty") or {}).get("cardmarket")
        if cm:
            return cm
    return None


def compact_card(card):
    """Houdt alleen de velden over die Stashdex nodig heeft."""
    out = {
        "id": card["id"],
        "localId": card.get("localId", ""),
        "name": card.get("name", ""),
        "rarity": card.get("rarity") if card.get("rarity") not in (None, "None") else None,
        "category": card.get("category"),
        "types": card.get("types") or [],
        "image": asset(card.get("image")),
        "cm": main_product(card),
    }
    return {k: v for k, v in out.items() if v not in (None, [], "")}


def brief_card(brief):
    """Noodversie als de details van een kaart niet op te halen waren."""
    return {k: v for k, v in {"id": brief["id"], "localId": brief.get("localId", ""), "name": brief.get("name", ""),
                              "image": asset(brief.get("image"))}.items() if v not in (None, "")}


def update_set(set_id, old_cards):
    """Haalt een set en al zijn kaarten op. Geeft (set-gegevens, kaarten, alles gelukt?)."""
    detail = api(f"sets/{set_id}")
    serie = detail.get("serie") or {}
    info = {
        "id": set_id,
        "name": detail.get("name", set_id),
        "serie": serie.get("name", ""),
        "serieId": serie.get("id", ""),
        "releaseDate": detail.get("releaseDate"),
        "official": (detail.get("cardCount") or {}).get("official"),
        "total": (detail.get("cardCount") or {}).get("total"),
        "logo": asset(detail.get("logo")),
        "symbol": asset(detail.get("symbol")),
    }
    if info["serieId"] in SKIP_SERIES:
        return info, [], True

    old = {c["id"]: c for c in old_cards}
    briefs = detail.get("cards") or []

    def one(brief):
        try:
            return compact_card(api(f"cards/{brief['id']}")), True
        except RuntimeError as err:
            print(f"  kaart {brief['id']} mislukt: {err}", flush=True)
            return old.get(brief["id"]) or brief_card(brief), False

    with ThreadPoolExecutor(THREADS) as pool:
        results = list(pool.map(one, briefs))
    cards = [c for c, _ in results]
    return info, cards, all(ok for _, ok in results)


def main(only):
    today = date.today()
    sets_path = CATALOG / "sets.json"
    known = {s["id"]: s for s in read_json(sets_path, [])}

    print("Setlijst ophalen ...", flush=True)
    listing = [s for s in api("sets") if SAFE_ID.match(s.get("id", ""))]
    listed = {s["id"]: s for s in listing}

    def due(set_id):
        k = known.get(set_id)
        if not k or not k.get("checked"):
            return "nieuw"
        if k.get("serieId") in SKIP_SERIES:
            return None
        if (listed[set_id].get("cardCount") or {}).get("total") != k.get("total"):
            return "aantal veranderd"
        if k.get("releaseDate") and date.fromisoformat(k["releaseDate"]) > today - timedelta(days=RECENT_DAYS):
            return "recent"
        return None

    if only:
        todo = [(i, "gevraagd") for i in listed if i in only]
    else:
        todo = [(i, r) for i in listed if (r := due(i))]
        # Rouleren: de oudst gecontroleerde sets eerst, een paar per nacht
        stale = sorted((k["checked"], i) for i, k in known.items() if i in listed and not due(i)
                       and k.get("serieId") not in SKIP_SERIES
                       and date.fromisoformat(k["checked"]) <= today - timedelta(days=RECHECK_DAYS))
        todo += [(i, "rouleren") for _, i in stale[:ROLL_PER_NIGHT]]

    print(f"{len(listed)} sets bij de bron, {len(todo)} te controleren", flush=True)
    failed = []
    for n, (set_id, reason) in enumerate(todo, 1):
        print(f"[{n}/{len(todo)}] {set_id} ({reason})", flush=True)
        path = CATALOG / "cards" / f"{set_id}.json"
        try:
            info, cards, complete = update_set(set_id, read_json(path, []))
        except RuntimeError as err:
            # Oude gegevens blijven staan; de set staat morgen weer op de lijst
            print(f"  OVERGESLAGEN (volgende nacht opnieuw): {err}", flush=True)
            failed.append(set_id)
            continue
        if info["serieId"] not in SKIP_SERIES:
            write_json(path, cards)
        # Alleen als alles lukte telt de set als gecontroleerd; anders morgen opnieuw
        info["checked"] = today.isoformat() if complete else (known.get(set_id) or {}).get("checked")
        if not complete:
            failed.append(set_id)
        known[set_id] = info

    write_json(sets_path, sorted(known.values(), key=lambda s: (s.get("releaseDate") or "", s["id"])))
    print(f"Klaar: {len(todo) - len(failed)} sets bijgewerkt, {len(failed)} (deels) mislukt {failed or ''}", flush=True)
    # Alleen falen als niets lukte, zodat GitHub dan een melding stuurt
    if todo and len(failed) == len(todo):
        sys.exit(1)


if __name__ == "__main__":
    main(set(sys.argv[1:]))

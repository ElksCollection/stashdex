"""Haalt alle Pokémon-sets en -kaarten met prijzen op van pokemontcg.io en
schrijft ze als compacte JSON-bestanden naar data/.

Gebruik:
    python scripts/fetch_cards.py            # alle sets
    python scripts/fetch_cards.py sv1 sv2    # alleen deze sets (om te testen)

Optioneel: zet POKEMONTCG_API_KEY als omgevingsvariabele voor een hogere limiet.
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.pokemontcg.io/v2"
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CARDS_DIR = DATA / "cards"

# Volgorde waarin de TCGPlayer-prijsvarianten gekozen worden als "hoofdprijs"
VARIANT_ORDER = [
    "holofoil", "normal", "reverseHolofoil",
    "1stEditionHolofoil", "1stEditionNormal", "unlimitedHolofoil", "unlimited",
]


def get_json(path, params, tries=6):
    """Vraagt een API-pagina op, met herhaalpogingen omdat de bron soms hapert."""
    url = f"{API}/{path}?{urllib.parse.urlencode(params)}"
    headers = {"User-Agent": "stashdex-fetcher"}
    key = os.environ.get("POKEMONTCG_API_KEY")
    if key:
        headers["X-Api-Key"] = key
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=90) as resp:
                return json.load(resp)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as err:
            if attempt == tries:
                break
            # Steeds langer wachten (10, 20, 40, 60, 60 s) zodat een haperende bron kan herstellen
            wait = min(10 * 2 ** (attempt - 1), 60)
            print(f"  poging {attempt}/{tries} mislukt ({err}), opnieuw over {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"ophalen mislukt: {url}")


def get_all(path, params):
    """Haalt alle pagina's van een lijst op (max 250 per pagina)."""
    items, page = [], 1
    while True:
        res = get_json(path, {**params, "page": page, "pageSize": 250})
        items.extend(res["data"])
        if len(items) >= res.get("totalCount", 0) or not res["data"]:
            return items
        page += 1


def number_key(number):
    """Sorteert kaartnummers zoals in de set: 1, 2, 10, TG01, SV1 ..."""
    match = re.match(r"^([A-Za-z]*)(\d+)(.*)$", number or "")
    if not match:
        return (1, number or "", 0, "")
    prefix, digits, rest = match.groups()
    return (1 if prefix else 0, prefix, int(digits), rest)


def compact_card(card):
    """Houdt alleen de velden over die de website nodig heeft."""
    tcg = (card.get("tcgplayer") or {}).get("prices") or {}
    variants = {name: p.get("market") for name, p in tcg.items() if p.get("market") is not None}
    main = next((variants[v] for v in VARIANT_ORDER if v in variants), None)
    if main is None and variants:
        main = next(iter(variants.values()))
    cm = (card.get("cardmarket") or {}).get("prices") or {}
    out = {
        "id": card["id"],
        "name": card["name"],
        "number": card.get("number", ""),
        "rarity": card.get("rarity"),
        "types": card.get("types") or [],
        "supertype": card.get("supertype"),
        "img": card["images"]["small"],
        "imgLarge": card["images"].get("large"),
        "usd": main,
        "usdVariants": variants,
        "eur": cm.get("trendPrice"),
    }
    # Lege velden weglaten houdt de bestanden klein
    return {k: v for k, v in out.items() if v not in (None, [], {})}


def write_json(path, data):
    """Schrijft JSON alleen als de inhoud echt veranderd is (minder ruis in git)."""
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return True


def fetch_set_cards(set_id):
    """Haalt alle kaarten van één set op en schrijft ze weg; geeft True als het bestand veranderde."""
    cards = get_all("cards", {
        "q": f"set.id:{set_id}",
        "select": "id,name,number,rarity,types,supertype,images,tcgplayer,cardmarket",
    })
    cards = sorted((compact_card(c) for c in cards), key=lambda c: number_key(c["number"]))
    return write_json(CARDS_DIR / f"{set_id}.json", cards)


def load_set_list():
    """Haalt de setlijst op; lukt dat niet, dan de bestaande lijst van de vorige keer gebruiken."""
    print("Sets ophalen ...")
    try:
        sets = get_all("sets", {"orderBy": "releaseDate"})
    except RuntimeError as err:
        old = DATA / "sets.json"
        if not old.exists():
            raise
        print(f"  Setlijst ophalen mislukt ({err}), bestaande lijst wordt gebruikt")
        return json.loads(old.read_text(encoding="utf-8"))
    set_list = [
        {
            "id": s["id"],
            "name": s["name"],
            "series": s["series"],
            "printedTotal": s.get("printedTotal"),
            "total": s.get("total"),
            "releaseDate": s.get("releaseDate"),
            "logo": s["images"].get("logo"),
            "symbol": s["images"].get("symbol"),
        }
        for s in sets
    ]
    write_json(DATA / "sets.json", set_list)
    return set_list


def main(only_sets):
    set_list = load_set_list()
    print(f"{len(set_list)} sets gevonden")

    targets = [s for s in set_list if not only_sets or s["id"] in only_sets]
    failed, changed = [], 0
    for i, s in enumerate(targets, 1):
        print(f"[{i}/{len(targets)}] {s['id']} {s['name']}")
        try:
            changed += fetch_set_cards(s["id"])
        except RuntimeError as err:
            # Bestaand bestand blijft staan, zodat de website niets kwijtraakt
            print(f"  OVERGESLAGEN (later nog een keer): {err}")
            failed.append(s["id"])

    # Tweede ronde voor de overgeslagen sets, na een pauze zodat de bron kan herstellen
    if failed:
        print(f"Tweede ronde voor {len(failed)} overgeslagen sets over 120s ...")
        time.sleep(120)
        still_failed = []
        for set_id in failed:
            print(f"[herkansing] {set_id}")
            try:
                changed += fetch_set_cards(set_id)
            except RuntimeError as err:
                print(f"  OVERGESLAGEN: {err}")
                still_failed.append(set_id)
        failed = still_failed

    if not only_sets:
        write_json(DATA / "meta.json", {
            "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
            "failedSets": failed,
        })
    print(f"Klaar: {changed} setbestanden gewijzigd, {len(failed)} mislukt {failed or ''}")
    # Alleen falen als niets lukte; gedeeltelijk gelukte data wordt wél opgeslagen en online gezet
    if targets and len(failed) == len(targets):
        sys.exit(1)


if __name__ == "__main__":
    main(set(sys.argv[1:]))

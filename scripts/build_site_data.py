"""Bouwt de bestanden die de website laadt, uit de catalogus en de prijs-momentopnames.

Heeft geen internet nodig. Schrijft (niet in git, wordt bij elke publicatie opnieuw gemaakt):
- data/sets.json               alle sets, met hoofdset/subset-koppeling
- data/cards/<set-id>.json     kaarten met de laatst bekende prijs
- data/history/<set-id>.json   prijsgeschiedenis per kaart ({"n": normaal, "r": reverse holo}), voor de grafieken
- data/meta.json               datum van de prijzen, begin van de geschiedenis en de dollarkoers
"""

import re
import shutil
from datetime import date, datetime, timezone

from common import CATALOG, DATA, PRICES, read_json, write_json

OVERRIDE_HOSTS = ("https://assets.tcgdex.net/", "https://images.scrydex.com/")  # alleen plaatjes van bekende bronnen
SUBSET = re.compile(r"^(.*?):? ?(Classic Collection|Trainer Gallery|Galarian Gallery|Shiny Vault)$")
DAILY_DAYS = 365   # geschiedenis per dag voor het laatste jaar, daarvoor per week (kleinere bestanden)


def number_key(number):
    """Sorteert kaartnummers zoals in de set: 1, 2, 10, TG01, SV1 ..."""
    match = re.match(r"^([A-Za-z]*)(\d+)(.*)$", number or "")
    if not match:
        return (1, number or "", 0, "")
    prefix, digits, rest = match.groups()
    return (1 if prefix else 0, prefix, int(digits), rest)


def find_parents(sets):
    """Koppelt subsets (bv. "30th Classic Collection") aan hun hoofdset in dezelfde serie."""
    for s in sets:
        m = SUBSET.match(s["name"])
        if not m or not m.group(1):
            continue
        prefix = m.group(1).strip()
        candidates = [p for p in sets if p is not s and p["serie"] == s["serie"] and not SUBSET.match(p["name"])
                      and (p["name"] == prefix or p["name"].startswith(prefix + " "))]
        if candidates:
            # Bij twijfel de hoofdset met de dichtstbijzijnde uitgiftedatum
            released = lambda x: date.fromisoformat(x.get("releaseDate") or "1990-01-01")
            parent = min(candidates, key=lambda p: abs((released(p) - released(s)).days))
            s["parent"], s["part"] = parent["id"], m.group(2)


def load_history():
    """Alle momentopnames op datum; oudere dan een jaar alleen één per week."""
    files = sorted(PRICES.glob("????-??-??.json"))
    if not files:
        return [], []
    last = date.fromisoformat(files[-1].stem)
    keep = [f for f in files if (last - date.fromisoformat(f.stem)).days <= DAILY_DAYS
            or (last - date.fromisoformat(f.stem)).days % 7 == 0]
    return [f.stem for f in keep], [read_json(f)["prices"] for f in keep]


def main():
    sets = [s for s in read_json(CATALOG / "sets.json", []) if (CATALOG / "cards" / f"{s['id']}.json").exists()]
    find_parents(sets)
    dates, snapshots = load_history()
    latest = snapshots[-1] if snapshots else {}
    # Eigen aanvullingen per kaart (bv. gedrukt nummer of reserveplaatje), zie data/catalog/overrides.json
    overrides = (read_json(CATALOG / "overrides.json", {}) or {}).get("cards", {})

    # Oude bestanden weg, zodat verdwenen sets niet blijven hangen
    for folder in ("cards", "history"):
        shutil.rmtree(DATA / folder, ignore_errors=True)

    out_sets = []
    for s in sets:
        cards = sorted(read_json(CATALOG / "cards" / f"{s['id']}.json", []), key=lambda c: number_key(c.get("localId")))
        if not cards:
            continue
        site_cards, history = [], {}
        for c in cards:
            pid = str(c.get("cm", ""))
            trend, rev = (latest.get(pid) or [None, None])
            has_rev = bool(c.get("rev"))
            card = {
                "id": c["id"], "name": c["name"], "number": c.get("localId", ""),
                # Classic Collection-kaarten hebben bij de bron geen zeldzaamheid; die van de subset zelf gebruiken
                "rarity": c.get("rarity") or ("Classic Collection" if s.get("part") == "Classic Collection" else None),
                "types": c.get("types", []), "supertype": c.get("category"),
                "img": c["image"] + "/low.webp" if c.get("image") else None,
                "imgLarge": c["image"] + "/high.webp" if c.get("image") else None,
                # Bestaat er een reverse holo, dan is dat een aparte kaart met een eigen prijs (eurRev);
                # anders is er maar één versie en geldt de trendprijs (of, als die ontbreekt, die van Cardmarket's holo-veld)
                "rev": has_rev or None,
                "eur": trend if has_rev else (trend or rev),
                "eurRev": rev if has_rev else None,
            }
            extra = overrides.get(c["id"], {})
            if extra.get("number"):
                card["number"] = extra["number"]
            if not card["img"] and str(extra.get("img", "")).startswith(OVERRIDE_HOSTS):
                card["img"], card["imgLarge"] = extra["img"], extra.get("imgLarge") or extra["img"]
            site_cards.append({k: v for k, v in card.items() if v not in (None, [], "")})
            # Per dag dezelfde keuze als de prijzen hierboven: n = normale versie, r = reverse holo
            pairs = [snap.get(pid) or [None, None] for snap in snapshots]
            normal = [(p[0] if has_rev else (p[0] or p[1])) for p in pairs]
            reverse = [p[1] for p in pairs] if has_rev else []
            entry = {k: v for k, v in (("n", normal), ("r", reverse)) if any(x is not None for x in v)}
            if entry:
                history[c["id"]] = entry
        write_json(DATA / "cards" / f"{s['id']}.json", site_cards)
        if history:
            write_json(DATA / "history" / f"{s['id']}.json", {"dates": dates, "prices": history})
        out_sets.append({k: v for k, v in {
            "id": s["id"], "name": s["name"], "series": s["serie"], "releaseDate": s.get("releaseDate"),
            "printedTotal": s.get("official"), "total": len(site_cards),
            "logo": s["logo"] + ".png" if s.get("logo") else None,
            "parent": s.get("parent"), "part": s.get("part"),
        }.items() if v is not None})

    write_json(DATA / "sets.json", out_sets)
    # Dollarkoers van de ECB (zie update_rates.py); ontbreekt die, dan gebruikt de site een reservekoers
    rate = read_json(PRICES / "koers.json", {}) or {}
    write_json(DATA / "meta.json", {
        "builtAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "pricesDate": dates[-1] if dates else None,
        "historyStart": dates[0] if dates else None,
        "eurUsd": rate.get("eurUsd"),
        "rateDate": rate.get("date"),
    })
    print(f"Klaar: {len(out_sets)} sets, prijzen van {dates[-1] if dates else 'nog geen'}, "
          f"geschiedenis {len(dates)} {'dag' if len(dates) == 1 else 'dagen'}")


if __name__ == "__main__":
    main()

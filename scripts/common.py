"""Gedeelde hulpjes voor de datascripts: paden, downloaden met herhaalpogingen, JSON schrijven."""

import json
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CATALOG = DATA / "catalog"          # kaartgegevens van TCGdex (in git)
PRICES = DATA / "prices"            # dagelijkse prijs-momentopnames (in git)


def fetch(url, tries=6, timeout=90):
    """Downloadt een adres, met steeds langer wachten (10, 20, 40, 60, 60 s) als de bron hapert."""
    headers = {"User-Agent": "stashdex-fetcher (github.com/ElksCollection/stashdex)"}
    for attempt in range(1, tries + 1):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as resp:
                return resp.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
            # 404 = bestaat niet; opnieuw proberen heeft dan geen zin
            if isinstance(err, urllib.error.HTTPError) and err.code == 404:
                raise RuntimeError(f"niet gevonden: {url}") from err
            if attempt == tries:
                raise RuntimeError(f"ophalen mislukt: {url} ({err})") from err
            wait = min(10 * 2 ** (attempt - 1), 60)
            print(f"  poging {attempt}/{tries} mislukt ({err}), opnieuw over {wait}s", flush=True)
            time.sleep(wait)


def fetch_json(url, **kwargs):
    """Downloadt en leest JSON; kapotte JSON telt als mislukte poging."""
    try:
        return json.loads(fetch(url, **kwargs))
    except json.JSONDecodeError as err:
        raise RuntimeError(f"onleesbare gegevens: {url}") from err


def read_json(path, fallback=None):
    """Leest een JSON-bestand, of geeft de fallback als het niet bestaat."""
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else fallback


def write_json(path, data):
    """Schrijft compacte JSON, alleen als de inhoud echt veranderd is (minder ruis in git)."""
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return True

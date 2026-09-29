"""Haalt de officiële dollarkoers van vandaag op bij de Europese Centrale Bank (ECB).

De ECB zet elke werkdag rond 16:00 (Frankfurt) de referentiekoersen online; gratis
en zonder sleutel. Wij bewaren alleen de dollarkoers in data/prices/koers.json:
{"date": "JJJJ-MM-DD", "eurUsd": 1.17} = 1 euro is 1,17 dollar.
Lukt het ophalen niet, dan blijft de vorige koers staan.
"""

import sys
import xml.etree.ElementTree as ET

from common import PRICES, fetch, read_json, write_json

ECB_DAILY = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
RATE_FILE = PRICES / "koers.json"


def main():
    print("Dollarkoers van de ECB ophalen ...", flush=True)
    try:
        root = ET.fromstring(fetch(ECB_DAILY, tries=4, timeout=60))
    except (RuntimeError, ET.ParseError) as err:
        sys.exit(f"Koers ophalen mislukt: {err}")

    # Opbouw: <Cube><Cube time="JJJJ-MM-DD"><Cube currency="USD" rate="1.17"/>...</Cube></Cube>
    day_cube = next((c for c in root.iter() if c.get("time")), None)
    usd = next((c for c in root.iter() if c.get("currency") == "USD"), None)
    try:
        day, rate = day_cube.get("time"), float(usd.get("rate"))
    except (AttributeError, TypeError, ValueError):
        sys.exit("Onverwachte opbouw van het ECB-bestand; koers niet opgeslagen")

    # Controle: een koers ver buiten het normale bereik is vrijwel zeker een fout
    if not 0.5 < rate < 2.5 or len(day or "") != 10:
        sys.exit(f"Onwaarschijnlijke koers ({rate} op {day}); niet opgeslagen")

    old = read_json(RATE_FILE, {}) or {}
    if old.get("date", "") > day:
        sys.exit(f"Opgehaalde koers ({day}) is ouder dan de bewaarde ({old['date']}); niet opgeslagen")
    write_json(RATE_FILE, {"date": day, "eurUsd": rate})
    print(f"Klaar: 1 euro = {rate} dollar (koers van {day})", flush=True)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
build_streets_json.py
- Dükkân (shop) adresini geocode eder (Nominatim), olmazsa sabit koordinatı kullanır.
- Verilen Berlin PLZ alanlarını Overpass'ten çeker (boundary=postal_code).
- Sadece highway + name içeren yolların (sokakların) adlarını alır.
- Her sokağın merkezini dükkâna göre ölçer; 8 km içinde olanları tutar.
- Çıktıyı app/data/streets.json dosyasına yazar.

Kullanım:
  python build_streets_json.py
"""

import json
import math
import time
import pathlib
import sys
from typing import Dict, List, Set, Tuple

import requests

# ============== AYARLAR ==============

# Dükkân adresin:
SHOP_ADDRESS = "Berliner Straße 9, 13507 Berlin, Germany"

# Eğer geocoding başarısız olursa fallback koordinatlar (Tegel civarı güvenli tahmin)
FALLBACK_COORD = (52.5865, 13.2862)  # (lat, lon)

# Yarıçap filtresi (kilometre)
RADIUS_KM = 8.0

# Hangi PLZ'leri alalım?
PLZ_LIST = [
    "13507",
    "13509",
    "13437",
    "13467",
    "13469",
    "13503",
    "13505",
    "13403",
    "13405",
]

# Çıkış dosyası:
OUT_PATH = pathlib.Path("app/data/streets.json")

# HTTP header’ları (Nominatim/Overpass nezaketi)
HEADERS = {
    "User-Agent": "BurgerBrothers-StreetBuilder/1.0 (contact: youremail@example.com)"
}

# Overpass endpoint
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
# Yedek olarak kullanılabilir (gerekirse):
# OVERPASS_URL = "https://overpass.kumi.systems/api/interpreter"

# Nominatim endpoint
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

# ============ YARDIMCI FONKSİYONLAR ============

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0088
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dl/2)**2
    c = 2 * math.asin(math.sqrt(a))
    return R * c


def geocode_address(addr: str) -> Tuple[float, float]:
    params = {"q": addr, "format": "json", "limit": 1}
    try:
        r = requests.get(NOMINATIM_URL, params=params, headers=HEADERS, timeout=20)
        r.raise_for_status()
        data = r.json()
        if data:
            lat = float(data[0]["lat"])
            lon = float(data[0]["lon"])
            print(f"[geo] Found coordinates for '{addr}': {lat:.6f}, {lon:.6f}")
            return (lat, lon)
        print("[geo] No result from Nominatim, using fallback.")
    except Exception as e:
        print(f"[geo] Nominatim failed: {e}. Using fallback.")
    return FALLBACK_COORD


def overpass_query_for_plz(plz: str) -> dict:
    """
    PLZ sınır alanını bul ve bu alan içinde isimli highway'leri çek.
    Not: area["postal_code"="..."]["boundary"="postal_code"] üzerinden gidiyoruz.
    """
    # Overpass QL:
    # 1) area id: area[boundary=postal_code]["postal_code"="13507"];
    # 2) o alandaki yollar: way(area)[highway][name];
    query = f"""
    [out:json][timeout:60];
    area
      ["boundary"="postal_code"]
      ["postal_code"="{plz}"]
      -> .searchArea;
    (
      way(area.searchArea)[highway][name];
    );
    out center;
    """
    # center ile her way için merkez lat/lon gelsin
    for attempt in range(3):
        try:
            r = requests.post(OVERPASS_URL, data={"data": query}, headers=HEADERS, timeout=180)
            if r.status_code == 429:
                # Rate limit; bekle
                wait = 5 + attempt * 5
                print(f"[overpass] 429 rate limit, waiting {wait}s …")
                time.sleep(wait)
                continue
            r.raise_for_status()
            return r.json()
        except Exception as e:
            wait = 3 + attempt * 3
            print(f"[overpass] Error (attempt {attempt+1}/3): {e} -> wait {wait}s")
            time.sleep(wait)
    print(f"[overpass] Failed for PLZ {plz}. Returning empty result.")
    return {"elements": []}


def normalize_street_name(name: str) -> str:
    # Küçük normalizasyon (gerekiyorsa genişletilebilir)
    name = name.strip()
    # Örn: birden fazla boşluğu tek boşluğa indir:
    name = " ".join(name.split())
    return name


# ============ ANA AKIŞ ============

def build_streets(shop_coord: Tuple[float, float], plz_list: List[str], radius_km: float) -> Dict[str, List[str]]:
    shop_lat, shop_lon = shop_coord
    result: Dict[str, Set[str]] = {}

    for plz in plz_list:
        print(f"\n=== PLZ {plz} ===")
        data = overpass_query_for_plz(plz)
        names: Set[str] = set()

        elems = data.get("elements", [])
        print(f"[overpass] {len(elems)} ways fetched for PLZ {plz}")

        kept = 0
        for el in elems:
            if el.get("type") != "way":
                continue
            tags = el.get("tags", {})
            name = tags.get("name")
            if not name:
                continue

            # Merkez koordinat
            center = el.get("center") or {}
            lat = center.get("lat")
            lon = center.get("lon")

            # center yoksa, skip (alternatif: node’ları okuyup ortalama alabilirdik)
            if lat is None or lon is None:
                continue

            dist = haversine_km(shop_lat, shop_lon, float(lat), float(lon))
            if dist <= radius_km:
                names.add(normalize_street_name(name))
                kept += 1

        # set → sorted list
        result[plz] = sorted(names)
        print(f"[filter] kept {kept} street ways within {radius_km} km; unique names: {len(result[plz])}")

        # ufak bir bekleme (Overpass'e nazik olalım)
        time.sleep(1.5)

    # set’leri list’e çevir
    return {k: list(v) for k, v in result.items()}


def main():
    print("== Burger Brothers • Streets Builder ==")
    shop_coord = geocode_address(SHOP_ADDRESS)
    print(f"[shop] Using coordinates: {shop_coord[0]:.6f}, {shop_coord[1]:.6f}")
    data = build_streets(shop_coord, PLZ_LIST, RADIUS_KM)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    total = sum(len(v) for v in data.values())
    print(f"\n[done] Wrote {OUT_PATH}  (total streets: {total})")


if __name__ == "__main__":
    sys.exit(main())

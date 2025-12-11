import os
import csv
import time
import json
import re
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
import pandas as pd

# --------------------------------------------------
# CONFIG
# --------------------------------------------------

# Folder gde su tvoji artists_XX fajlovi
WORLD_FOLDER = os.path.join(os.path.expanduser("~"), "Desktop", "world")

# Gde upisujemo rezultat (u world-channel-ID folderu)
OUTPUT_FILE = "all_youtube_channels.csv"
ERROR_LOG = "errors.log"

MB_BASE_URL = "https://musicbrainz.org/ws/2/artist"

HEADERS = {
    "User-Agent": "PurpleMusicDataCollector/2.0 (nikolastojadinov@yahoo.co.uk)"
}

MAX_WORKERS = 10       # 10 niti => ~10x ubrzanje
MAX_RETRIES = 3
REQUEST_TIMEOUT = 15   # sekundi
SLEEP_BETWEEN_REQ = 0.4   # mala pauza da ne budemo preagresivni

# --------------------------------------------------
# Mapa country koda -> puno ime zemlje
# --------------------------------------------------

COUNTRY_NAMES = {
    "AF": "Afghanistan", "AL": "Albania", "DZ": "Algeria", "AS": "American Samoa",
    "AD": "Andorra", "AO": "Angola", "AI": "Anguilla", "AQ": "Antarctica",
    "AG": "Antigua and Barbuda", "AR": "Argentina", "AM": "Armenia",
    "AW": "Aruba", "AU": "Australia", "AT": "Austria", "AZ": "Azerbaijan",
    "BS": "Bahamas", "BH": "Bahrain", "BD": "Bangladesh", "BB": "Barbados",
    "BY": "Belarus", "BE": "Belgium", "BZ": "Belize", "BJ": "Benin",
    "BM": "Bermuda", "BT": "Bhutan", "BO": "Bolivia", "BA": "Bosnia and Herzegovina",
    "BW": "Botswana", "BR": "Brazil", "IO": "British Indian Ocean Territory",
    "BN": "Brunei Darussalam", "BG": "Bulgaria", "BF": "Burkina Faso",
    "BI": "Burundi", "CV": "Cabo Verde", "KH": "Cambodia", "CM": "Cameroon",
    "CA": "Canada", "KY": "Cayman Islands", "CF": "Central African Republic",
    "TD": "Chad", "CL": "Chile", "CN": "China", "CX": "Christmas Island",
    "CC": "Cocos (Keeling) Islands", "CO": "Colombia", "KM": "Comoros",
    "CD": "Congo, Democratic Republic of the", "CG": "Congo",
    "CK": "Cook Islands", "CR": "Costa Rica", "CI": "Côte d'Ivoire",
    "HR": "Croatia", "CU": "Cuba", "CW": "Curaçao", "CY": "Cyprus",
    "CZ": "Czechia", "DK": "Denmark", "DJ": "Djibouti", "DM": "Dominica",
    "DO": "Dominican Republic", "EC": "Ecuador", "EG": "Egypt",
    "SV": "El Salvador", "GQ": "Equatorial Guinea", "ER": "Eritrea",
    "EE": "Estonia", "SZ": "Eswatini", "ET": "Ethiopia", "FK": "Falkland Islands",
    "FO": "Faroe Islands", "FJ": "Fiji", "FI": "Finland", "FR": "France",
    "GF": "French Guiana", "PF": "French Polynesia", "GA": "Gabon",
    "GM": "Gambia", "GE": "Georgia", "DE": "Germany", "GH": "Ghana",
    "GI": "Gibraltar", "GR": "Greece", "GL": "Greenland", "GD": "Grenada",
    "GP": "Guadeloupe", "GU": "Guam", "GT": "Guatemala", "GG": "Guernsey",
    "GN": "Guinea", "GW": "Guinea-Bissau", "GY": "Guyana", "HT": "Haiti",
    "HN": "Honduras", "HK": "Hong Kong", "HU": "Hungary", "IS": "Iceland",
    "IN": "India", "ID": "Indonesia", "IR": "Iran", "IQ": "Iraq",
    "IE": "Ireland", "IM": "Isle of Man", "IL": "Israel", "IT": "Italy",
    "JM": "Jamaica", "JP": "Japan", "JE": "Jersey", "JO": "Jordan",
    "KZ": "Kazakhstan", "KE": "Kenya", "KI": "Kiribati",
    "KP": "Korea, Democratic People's Republic of", "KR": "Korea, Republic of",
    "KW": "Kuwait", "KG": "Kyrgyzstan", "LA": "Lao People's Democratic Republic",
    "LV": "Latvia", "LB": "Lebanon", "LS": "Lesotho", "LR": "Liberia",
    "LY": "Libya", "LI": "Liechtenstein", "LT": "Lithuania", "LU": "Luxembourg",
    "MO": "Macao", "MK": "North Macedonia", "MG": "Madagascar", "MW": "Malawi",
    "MY": "Malaysia", "MV": "Maldives", "ML": "Mali", "MT": "Malta",
    "MH": "Marshall Islands", "MQ": "Martinique", "MR": "Mauritania",
    "MU": "Mauritius", "YT": "Mayotte", "MX": "Mexico", "FM": "Micronesia",
    "MD": "Moldova", "MC": "Monaco", "MN": "Mongolia", "ME": "Montenegro",
    "MS": "Montserrat", "MA": "Morocco", "MZ": "Mozambique", "MM": "Myanmar",
    "NA": "Namibia", "NR": "Nauru", "NP": "Nepal", "NL": "Netherlands",
    "NC": "New Caledonia", "NZ": "New Zealand", "NI": "Nicaragua",
    "NE": "Niger", "NG": "Nigeria", "NU": "Niue", "NF": "Norfolk Island",
    "MP": "Northern Mariana Islands", "NO": "Norway", "OM": "Oman",
    "PK": "Pakistan", "PW": "Palau", "PS": "Palestine", "PA": "Panama",
    "PG": "Papua New Guinea", "PY": "Paraguay", "PE": "Peru",
    "PH": "Philippines", "PN": "Pitcairn", "PL": "Poland", "PT": "Portugal",
    "PR": "Puerto Rico", "QA": "Qatar", "RE": "Réunion", "RO": "Romania",
    "RU": "Russian Federation", "RW": "Rwanda", "BL": "Saint Barthélemy",
    "SH": "Saint Helena, Ascension and Tristan da Cunha",
    "KN": "Saint Kitts and Nevis", "LC": "Saint Lucia",
    "MF": "Saint Martin (French part)", "PM": "Saint Pierre and Miquelon",
    "VC": "Saint Vincent and the Grenadines", "WS": "Samoa",
    "SM": "San Marino", "ST": "Sao Tome and Principe", "SA": "Saudi Arabia",
    "SN": "Senegal", "RS": "Serbia", "SC": "Seychelles", "SL": "Sierra Leone",
    "SG": "Singapore", "SX": "Sint Maarten (Dutch part)", "SK": "Slovakia",
    "SI": "Slovenia", "SB": "Solomon Islands", "SO": "Somalia",
    "ZA": "South Africa", "GS": "South Georgia and the South Sandwich Islands",
    "SS": "South Sudan", "ES": "Spain", "LK": "Sri Lanka", "SD": "Sudan",
    "SR": "Suriname", "SE": "Sweden", "CH": "Switzerland", "SY": "Syrian Arab Republic",
    "TW": "Taiwan", "TJ": "Tajikistan", "TZ": "Tanzania", "TH": "Thailand",
    "TL": "Timor-Leste", "TG": "Togo", "TK": "Tokelau", "TO": "Tonga",
    "TT": "Trinidad and Tobago", "TN": "Tunisia", "TR": "Türkiye",
    "TM": "Turkmenistan", "TC": "Turks and Caicos Islands", "TV": "Tuvalu",
    "UG": "Uganda", "UA": "Ukraine", "AE": "United Arab Emirates",
    "GB": "United Kingdom", "US": "United States of America", "UY": "Uruguay",
    "UZ": "Uzbekistan", "VU": "Vanuatu", "VA": "Holy See", "VE": "Venezuela",
    "VN": "Viet Nam", "VG": "Virgin Islands (British)", "VI": "Virgin Islands (U.S.)",
    "WF": "Wallis and Futuna", "EH": "Western Sahara", "YE": "Yemen",
    "ZM": "Zambia", "ZW": "Zimbabwe"
}


def country_full_name(code: str) -> str:
    if not code:
        return ""
    return COUNTRY_NAMES.get(code.upper(), code)


# --------------------------------------------------
# Pomocne funkcije
# --------------------------------------------------

def log_error(msg: str) -> None:
    print("[ERROR]", msg)
    with open(ERROR_LOG, "a", encoding="utf-8") as f:
        f.write(msg + "\n")


def parse_youtube_channel_id(url: str) -> str:
    """
    Pokušava da izvuče YouTube Channel ID iz URL-a.
    Radi 100% sigurno za forme:
      - https://youtube.com/channel/UCxxxx...
      - https://music.youtube.com/channel/UCxxxx...
    Ako ne pronađe UC... ID, vraća prazan string.
    """
    if not url:
        return ""

    try:
        parsed = urlparse(url)
    except Exception:
        return ""

    path = parsed.path.strip("/")  # npr "channel/UC27nr9wCiLTErKHK94VG3UA"
    parts = path.split("/")

    # /channel/UCxxxxxxxxxxxxxxxxxxxxxx
    if len(parts) >= 2 and parts[0].lower() == "channel":
        candidate = parts[1]
        # Klasičan YouTube channel ID: počinje sa "UC" i ima ~24 znaka
        if re.match(r"^UC[0-9A-Za-z_-]{20,}$", candidate):
            return candidate

    # ako je neka druga forma (user, @handle...) – ne diramo
    return ""


def safe_request(url: str, params: dict) -> dict | None:
    """GET sa retry logikom."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.get(
                url,
                headers=HEADERS,
                params=params,
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code == 503:
                # Service unavailable – sačekaj malo
                print(f"503 za {url}, pokušaj {attempt}/{MAX_RETRIES}")
                time.sleep(2.0 * attempt)
                continue

            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            log_error(f"HTTP error (attempt {attempt}) for {url}: {e}")
            time.sleep(1.0 * attempt)

    return None


def fetch_for_artist(record: dict) -> dict | None:
    """
    record: {mbid, name, country_code, country_name}
    vraća dict sa dodanim youtube_url i channel_id ili None ako nema ništa.
    """
    mbid = record["mbid"]
    url = f"{MB_BASE_URL}/{mbid}"

    params = {
        "fmt": "json",
        "inc": "url-rels",
    }

    data = safe_request(url, params)
    time.sleep(SLEEP_BETWEEN_REQ)  # globalno usporavanje

    if not data:
        return None

    relations = data.get("relations", [])
    youtube_url = ""

    for rel in relations:
        if "url" not in rel:
            continue
        resource = rel["url"].get("resource", "")
        if not resource:
            continue

        low = resource.lower()
        if "youtube.com" in low or "youtu.be" in low or "music.youtube.com" in low:
            youtube_url = resource
            break

    if not youtube_url:
        return None

    channel_id = parse_youtube_channel_id(youtube_url)

    return {
        "mbid": mbid,
        "name": record["name"],
        "country_code": record["country_code"],
        "country_name": record["country_name"],
        "youtube_url": youtube_url,
        "channel_id": channel_id,
    }


# --------------------------------------------------
# Učitavanje svih MBID-ova iz WORLD foldera
# --------------------------------------------------

def load_all_artists() -> list[dict]:
    all_records: list[dict] = []

    if not os.path.isdir(WORLD_FOLDER):
        raise RuntimeError(f"WORLD_FOLDER ne postoji: {WORLD_FOLDER}")

    for fname in os.listdir(WORLD_FOLDER):
        path = os.path.join(WORLD_FOLDER, fname)
        if not os.path.isfile(path):
            continue

        lower = fname.lower()
        if not (lower.endswith(".csv") or lower.endswith(".xlsx") or lower.endswith(".xls")):
            continue

        try:
            if lower.endswith(".csv"):
                df = pd.read_csv(path, encoding="utf-8", dtype=str)
            else:
                df = pd.read_excel(path, dtype=str)
        except Exception as e:
            log_error(f"Ne mogu da pročitam fajl {fname}: {e}")
            continue

        # Normalizuj nazive kolona
        cols = [c.strip().lower() for c in df.columns]

        def find_col(possible_names):
            for name in possible_names:
                if name in cols:
                    return df.columns[cols.index(name)]
            return None

        mbid_col = find_col(["mbid", "artist_mbid", "gid"])
        name_col = find_col(["name", "artist", "artist_name"])
        country_col = find_col(["country", "country_code"])

        if not mbid_col or not name_col:
            log_error(f"Preskačem {fname} – nema mbid ili name kolonu")
            continue

        for _, row in df.iterrows():
            mbid = str(row.get(mbid_col) or "").strip()
            name = str(row.get(name_col) or "").strip()
            country_code = str(row.get(country_col) or "").strip() if country_col else ""

            if not mbid or len(mbid) < 5:
                continue

            all_records.append({
                "mbid": mbid,
                "name": name,
                "country_code": country_code,
                "country_name": country_full_name(country_code),
            })

    # makni duplikate po MBID-u
    unique = {}
    for rec in all_records:
        unique[rec["mbid"]] = rec

    print(f"Našao ukupno {len(all_records)} zapisa, posle deduplikacije {len(unique)} MBID-ova.")
    return list(unique.values())


# --------------------------------------------------
# MAIN
# --------------------------------------------------

def main():
    print("WORLD_FOLDER =", WORLD_FOLDER)
    records = load_all_artists()
    if not records:
        print("Nema zapisa – proveri WORLD_FOLDER.")
        return

    results: list[dict] = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(fetch_for_artist, rec): rec for rec in records}

        for idx, future in enumerate(as_completed(futures), start=1):
            rec = futures[future]
            try:
                result = future.result()
                if result:
                    results.append(result)
                    print(f"[{idx}/{len(records)}] + {result['name']} | {result['country_code']} | {result['channel_id']}")
                else:
                    print(f"[{idx}/{len(records)}] - {rec['name']} (nema YouTube link)")
            except Exception as e:
                log_error(f"Greska u future za {rec['mbid']} / {rec['name']}: {e}")

    # upiši CSV
    if not results:
        print("Nema rezultata sa YouTube kanalima.")
        return

    out_path = os.path.join(os.path.dirname(__file__), OUTPUT_FILE)

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["mbid", "name", "country_code", "country_name", "youtube_url", "channel_id"])
        for r in results:
            writer.writerow([
                r["mbid"],
                r["name"],
                r["country_code"],
                r["country_name"],
                r["youtube_url"],
                r["channel_id"],
            ])

    print("\nGOTOVO → Sačuvano u:", out_path)
    print("Ukupno redova:", len(results))


if __name__ == "__main__":
    main()

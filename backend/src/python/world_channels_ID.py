import os
import json
import time
from urllib.parse import urlparse

import pandas as pd
import requests

# ---------------------------------------------------------------------
# CONFIG – PUTANJE I OKRUŽENJE
# ---------------------------------------------------------------------

BASE_DIR = os.path.dirname(__file__)
WORLD_FOLDER = os.path.join(BASE_DIR, "world")

ERROR_LOG = os.path.join(BASE_DIR, "world_channels_errors.log")

RATE_LIMIT_SECONDS = 0.3  # pauza između poziva prema MusicBrainz

# Supabase okruženje (render.yaml)
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
TABLE = "youtube_channels"

SUPA_HEADERS = {
    "apikey": SUPABASE_KEY or "",
    "Authorization": f"Bearer {SUPABASE_KEY}" if SUPABASE_KEY else "",
    "Content-Type": "application/json",
    "Prefer": "resolution=ignore-duplicates"
}

# MusicBrainz HTTP header
MB_HEADERS = {
    "User-Agent": "PurpleMusicDataCollector/3.1 (nikolastojadinov@yahoo.co.uk)"
}

# ---------------------------------------------------------------------
# COUNTRY MAP
# ---------------------------------------------------------------------

COUNTRY_MAP = {
    "AF": "Afghanistan", "AL": "Albania", "DZ": "Algeria", "AS": "American Samoa",
    "AD": "Andorra", "AO": "Angola", "AI": "Anguilla", "AQ": "Antarctica",
    "AG": "Antigua and Barbuda", "AR": "Argentina", "AM": "Armenia", "AW": "Aruba",
    "AU": "Australia", "AT": "Austria", "AZ": "Azerbaijan", "BS": "Bahamas",
    "BH": "Bahrain", "BD": "Bangladesh", "BB": "Barbados", "BY": "Belarus",
    "BE": "Belgium", "BZ": "Belize", "BJ": "Benin", "BM": "Bermuda", "BT": "Bhutan",
    "BO": "Bolivia", "BA": "Bosnia and Herzegovina", "BW": "Botswana", "BR": "Brazil",
    "IO": "British Indian Ocean Territory", "BN": "Brunei Darussalam",
    "BG": "Bulgaria", "BF": "Burkina Faso", "BI": "Burundi", "CV": "Cabo Verde",
    "KH": "Cambodia", "CM": "Cameroon", "CA": "Canada", "KY": "Cayman Islands",
    "CF": "Central African Republic", "TD": "Chad", "CL": "Chile", "CN": "China",
    "CX": "Christmas Island", "CC": "Cocos (Keeling) Islands", "CO": "Colombia",
    "KM": "Comoros", "CD": "Congo, Democratic Republic of the", "CG": "Congo",
    "CK": "Cook Islands", "CR": "Costa Rica", "CI": "Côte d'Ivoire", "HR": "Croatia",
    "CU": "Cuba", "CW": "Curaçao", "CY": "Cyprus", "CZ": "Czechia", "DK": "Denmark",
    "DJ": "Djibouti", "DM": "Dominica", "DO": "Dominican Republic", "EC": "Ecuador",
    "EG": "Egypt", "SV": "El Salvador", "GQ": "Equatorial Guinea", "ER": "Eritrea",
    "EE": "Estonia", "SZ": "Eswatini", "ET": "Ethiopia", "FK": "Falkland Islands",
    "FO": "Faroe Islands", "FJ": "Fiji", "FI": "Finland", "FR": "France",
    "GF": "French Guiana", "PF": "French Polynesia", "GA": "Gabon", "GM": "Gambia",
    "GE": "Georgia", "DE": "Germany", "GH": "Ghana", "GI": "Gibraltar", "GR": "Greece",
    "GL": "Greenland", "GD": "Grenada", "GP": "Guadeloupe", "GU": "Guam",
    "GT": "Guatemala", "GG": "Guernsey", "GN": "Guinea", "GW": "Guinea-Bissau",
    "GY": "Guyana", "HT": "Haiti", "HN": "Honduras", "HK": "Hong Kong", "HU": "Hungary",
    "IS": "Iceland", "IN": "India", "ID": "Indonesia", "IR": "Iran", "IQ": "Iraq",
    "IE": "Ireland", "IM": "Isle of Man", "IL": "Israel", "IT": "Italy",
    "JM": "Jamaica", "JP": "Japan", "JE": "Jersey", "JO": "Jordan", "KZ": "Kazakhstan",
    "KE": "Kenya", "KI": "Kiribati", "KP": "Korea, Democratic People's Republic of",
    "KR": "Korea, Republic of", "KW": "Kuwait", "KG": "Kyrgyzstan",
    "LA": "Lao People's Democratic Republic", "LV": "Latvia", "LB": "Lebanon",
    "LS": "Lesotho", "LR": "Liberia", "LY": "Libya", "LI": "Liechtenstein",
    "LT": "Lithuania", "LU": "Luxembourg", "MO": "Macao",
    "MK": "North Macedonia", "MG": "Madagascar", "MW": "Malawi", "MY": "Malaysia",
    "MV": "Maldives", "ML": "Mali", "MT": "Malta", "MH": "Marshall Islands",
    "MQ": "Martinique", "MR": "Mauritania", "MU": "Mauritius", "YT": "Mayotte",
    "MX": "Mexico", "FM": "Micronesia, Federated States of", "MD": "Moldova",
    "MC": "Monaco", "MN": "Mongolia", "ME": "Montenegro", "MS": "Montserrat",
    "MA": "Morocco", "MZ": "Mozambique", "MM": "Myanmar", "NA": "Namibia",
    "NR": "Nauru", "NP": "Nepal", "NL": "Netherlands", "NC": "New Caledonia",
    "NZ": "New Zealand", "NI": "Nicaragua", "NE": "Niger", "NG": "Nigeria",
    "NU": "Niue", "NF": "Norfolk Island", "MP": "Northern Mariana Islands",
    "NO": "Norway", "OM": "Oman", "PK": "Pakistan", "PW": "Palau",
    "PS": "Palestine, State of", "PA": "Panama", "PG": "Papua New Guinea",
    "PY": "Paraguay", "PE": "Peru", "PH": "Philippines", "PN": "Pitcairn",
    "PL": "Poland", "PT": "Portugal", "PR": "Puerto Rico", "QA": "Qatar",
    "RE": "Réunion", "RO": "Romania", "RU": "Russian Federation", "RW": "Rwanda",
    "BL": "Saint Barthélemy", "SH": "Saint Helena, Ascension and Tristan da Cunha",
    "KN": "Saint Kitts and Nevis", "LC": "Saint Lucia",
    "MF": "Saint Martin (French part)", "PM": "Saint Pierre and Miquelon",
    "VC": "Saint Vincent and the Grenadines", "WS": "Samoa", "SM": "San Marino",
    "ST": "Sao Tome and Principe", "SA": "Saudi Arabia", "SN": "Senegal",
    "RS": "Serbia", "SC": "Seychelles", "SL": "Sierra Leone", "SG": "Singapore",
    "SX": "Sint Maarten (Dutch part)", "SK": "Slovakia", "SI": "Slovenia",
    "SB": "Solomon Islands", "SO": "Somalia", "ZA": "South Africa",
    "GS": "South Georgia and the South Sandwich Islands", "SS": "South Sudan",
    "ES": "Spain", "LK": "Sri Lanka", "SD": "Sudan", "SR": "Suriname",
    "SE": "Sweden", "CH": "Switzerland", "SY": "Syrian Arab Republic",
    "TW": "Taiwan", "TJ": "Tajikistan", "TZ": "Tanzania, United Republic of",
    "TH": "Thailand", "TL": "Timor-Leste", "TG": "Togo", "TK": "Tokelau",
    "TO": "Tonga", "TT": "Trinidad and Tobago", "TN": "Tunisia", "TR": "Türkiye",
    "TM": "Turkmenistan", "TC": "Turks and Caicos Islands", "TV": "Tuvalu",
    "UG": "Uganda", "UA": "Ukraine", "AE": "United Arab Emirates",
    "GB": "United Kingdom", "US": "United States of America", "UY": "Uruguay",
    "UZ": "Uzbekistan", "VU": "Vanuatu", "VA": "Holy See", "VE": "Venezuela",
    "VN": "Viet Nam", "VG": "Virgin Islands (British)", "VI": "Virgin Islands (U.S.)",
    "WF": "Wallis and Futuna", "EH": "Western Sahara", "YE": "Yemen",
    "ZM": "Zambia", "ZW": "Zimbabwe",
}

# ---------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------

def log_error(msg: str) -> None:
    try:
        with open(ERROR_LOG, "a", encoding="utf-8") as f:
            f.write(msg + "\n")
    except Exception:
        pass


def extract_channel_id(url: str) -> str:
    if not url:
        return ""

    try:
        parsed = urlparse(url)
        parts = parsed.path.split("/")

        if "channel" in parts:
            idx = parts.index("channel")
            if idx + 1 < len(parts):
                return parts[idx + 1]

        if "user" in parts:
            return ""

        if len(parts) > 1 and parts[1].startswith("@"):
            return ""

        return ""
    except Exception:
        return ""


def fetch_youtube_using_mbid(session: requests.Session, mbid: str) -> str:
    url = f"https://musicbrainz.org/ws/2/artist/{mbid}?fmt=json&inc=url-rels"

    try:
        r = session.get(url, headers=MB_HEADERS, timeout=15)
        r.raise_for_status()
        data = r.json()

        for rel in data.get("relations", []):
            link = rel.get("url", {}).get("resource", "")
            if "youtube.com" in link:
                return extract_channel_id(link)

    except Exception as e:
        log_error(f"{mbid}: {e}")

    return ""


def supabase_insert(row: dict) -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("⚠ SUPABASE_URL ili SUPABASE_SERVICE_ROLE_KEY nisu podešeni.")
        return

    url = f"{SUPABASE_URL}/rest/v1/{TABLE}?on_conflict=mbid"

    try:
        r = requests.post(url, headers=SUPA_HEADERS, data=json.dumps(row), timeout=20)
        if r.status_code not in (200, 201, 204):
            print("❌ Supabase error:", r.status_code, r.text[:200])
            log_error(f"SUPABASE {r.status_code}: {r.text[:500]}")
    except Exception as e:
        print("❌ Supabase exception:", e)
        log_error(f"SUPABASE EXC: {e}")


# ---------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------

def main():
    if not os.path.isdir(WORLD_FOLDER):
        print("❌ WORLD_FOLDER ne postoji:", WORLD_FOLDER)
        return

    print("WORLD_FOLDER:", WORLD_FOLDER)
    print("Supabase table:", TABLE)

    mb_session = requests.Session()
    total_processed = 0

    files = sorted(
        f for f in os.listdir(WORLD_FOLDER)
        if f.startswith("artists_") and f.endswith(".csv")
    )

    if not files:
        print("⚠ Nema CSV fajlova u world folderu.")
        return

    for file in files:
        path = os.path.join(WORLD_FOLDER, file)
        print(f"\n📄 Processing file → {file}")

        try:
            df = pd.read_csv(path, encoding="utf-8")
        except Exception as e:
            print("❌ Ne mogu da pročitam CSV:", file, e)
            log_error(f"CSV READ {file}: {e}")
            continue

        for _, row in df.iterrows():
            name = row.get("name")
            mbid = row.get("MBID") or row.get("mbid") or ""
            country_code = str(row.get("country", "")).upper()

            if not mbid or pd.isna(mbid):
                continue

            country_name = COUNTRY_MAP.get(country_code, country_code)

            channel_id = fetch_youtube_using_mbid(mb_session, mbid)
            time.sleep(RATE_LIMIT_SECONDS)

            # 🚫 Ako nema YouTube kanal → PRESKOČI
            if not channel_id:
                continue

            payload = {
                "name": name,
                "mbid": mbid,
                "youtube_channel_id": channel_id,
                "country_code": country_code,
                "country_name": country_name,
            }

            supabase_insert(payload)
            total_processed += 1

            print(f"✓ {name} | {mbid} | {channel_id} | {country_name}")

    print("\n✅ GOTOVO.")
    print("Ukupno upisanih izvođača sa YouTube kanalima:", total_processed)


if __name__ == "__main__":
    main()

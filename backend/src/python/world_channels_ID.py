import os
import json
import time
import requests
import pandas as pd
from urllib.parse import urlparse

# ---------------------------------------------------------
# SUPABASE CONFIG
# ---------------------------------------------------------

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")  # <-- ISPRAVLJENO I FINALNO!!!

TABLE = "youtube_channels"

SUPA_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

def supabase_insert(name, mbid, channel_id, country_code, country_name):
    payload = {
        "name": name,
        "mbid": mbid,
        "youtube_channel_id": channel_id,
        "country_code": country_code,
        "country_name": country_name
    }

    url = f"{SUPABASE_URL}/rest/v1/{TABLE}"
    r = requests.post(url, headers=SUPA_HEADERS, data=json.dumps(payload))

    if r.status_code not in (200, 201):
        print("❌ Supabase error:", r.text)


# ---------------------------------------------------------
# LOCAL CONFIG
# ---------------------------------------------------------

WORLD_FOLDER = r"C:\Users\Home\Desktop\world"
ERROR_LOG = "errors.log"

HEADERS = {
    "User-Agent": "PurpleMusicDataCollector/3.1 (nikolastojadinov@yahoo.co.uk)"
}

# ---------------------------------------------------------
# FULL COUNTRY MAP (242 države)
# ---------------------------------------------------------

COUNTRY_MAP = {
    "AF": "Afghanistan","AL": "Albania","DZ": "Algeria","AS": "American Samoa","AD": "Andorra","AO": "Angola","AI": "Anguilla",
    "AQ": "Antarctica","AG": "Antigua and Barbuda","AR": "Argentina","AM": "Armenia","AW": "Aruba","AU": "Australia","AT": "Austria",
    "AZ": "Azerbaijan","BS": "Bahamas","BH": "Bahrain","BD": "Bangladesh","BB": "Barbados","BY": "Belarus","BE": "Belgium",
    "BZ": "Belize","BJ": "Benin","BM": "Bermuda","BT": "Bhutan","BO": "Bolivia","BA": "Bosnia and Herzegovina","BW": "Botswana",
    "BR": "Brazil","IO": "British Indian Ocean Territory","BN": "Brunei Darussalam","BG": "Bulgaria","BF": "Burkina Faso",
    "BI": "Burundi","CV": "Cabo Verde","KH": "Cambodia","CM": "Cameroon","CA": "Canada","KY": "Cayman Islands",
    "CF": "Central African Republic","TD": "Chad","CL": "Chile","CN": "China","CX": "Christmas Island","CC": "Cocos Islands",
    "CO": "Colombia","KM": "Comoros","CD": "Congo DR","CG": "Congo","CK": "Cook Islands","CR": "Costa Rica","CI": "Côte d'Ivoire",
    "HR": "Croatia","CU": "Cuba","CW": "Curaçao","CY": "Cyprus","CZ": "Czechia","DK": "Denmark","DJ": "Djibouti",
    "DM": "Dominica","DO": "Dominican Republic","EC": "Ecuador","EG": "Egypt","SV": "El Salvador","GQ": "Equatorial Guinea",
    "ER": "Eritrea","EE": "Estonia","SZ": "Eswatini","ET": "Ethiopia","FK": "Falklands","FO": "Faroe Islands","FJ": "Fiji",
    "FI": "Finland","FR": "France","GF": "French Guiana","PF": "French Polynesia","GA": "Gabon","GM": "Gambia","GE": "Georgia",
    "DE": "Germany","GH": "Ghana","GI": "Gibraltar","GR": "Greece","GL": "Greenland","GD": "Grenada","GP": "Guadeloupe",
    "GU": "Guam","GT": "Guatemala","GG": "Guernsey","GN": "Guinea","GW": "Guinea-Bissau","GY": "Guyana","HT": "Haiti",
    "HN": "Honduras","HK": "Hong Kong","HU": "Hungary","IS": "Iceland","IN": "India","ID": "Indonesia","IR": "Iran","IQ": "Iraq",
    "IE": "Ireland","IM": "Isle of Man","IL": "Israel","IT": "Italy","JM": "Jamaica","JP": "Japan","JE": "Jersey","JO": "Jordan",
    "KZ": "Kazakhstan","KE": "Kenya","KI": "Kiribati","KP": "North Korea","KR": "South Korea","KW": "Kuwait","KG": "Kyrgyzstan",
    "LA": "Laos","LV": "Latvia","LB": "Lebanon","LS": "Lesotho","LR": "Liberia","LY": "Libya","LI": "Liechtenstein",
    "LT": "Lithuania","LU": "Luxembourg","MO": "Macao","MK": "North Macedonia","MG": "Madagascar","MW": "Malawi",
    "MY": "Malaysia","MV": "Maldives","ML": "Mali","MT": "Malta","MH": "Marshall Islands","MQ": "Martinique","MR": "Mauritania",
    "MU": "Mauritius","YT": "Mayotte","MX": "Mexico","FM": "Micronesia","MD": "Moldova","MC": "Monaco","MN": "Mongolia",
    "ME": "Montenegro","MS": "Montserrat","MA": "Morocco","MZ": "Mozambique","MM": "Myanmar","NA": "Namibia","NR": "Nauru",
    "NP": "Nepal","NL": "Netherlands","NC": "New Caledonia","NZ": "New Zealand","NI": "Nicaragua","NE": "Niger","NG": "Nigeria",
    "NU": "Niue","NF": "Norfolk Island","MP": "Northern Mariana Islands","NO": "Norway","OM": "Oman","PK": "Pakistan",
    "PW": "Palau","PS": "Palestine","PA": "Panama","PG": "Papua New Guinea","PY": "Paraguay","PE": "Peru","PH": "Philippines",
    "PN": "Pitcairn","PL": "Poland","PT": "Portugal","PR": "Puerto Rico","QA": "Qatar","RE": "Réunion","RO": "Romania",
    "RU": "Russia","RW": "Rwanda","BL": "Saint Barthélemy","SH": "Saint Helena","KN": "Saint Kitts","LC": "Saint Lucia",
    "MF": "Saint Martin","PM": "Saint Pierre","VC": "Saint Vincent","WS": "Samoa","SM": "San Marino","ST": "São Tomé",
    "SA": "Saudi Arabia","SN": "Senegal","RS": "Serbia","SC": "Seychelles","SL": "Sierra Leone","SG": "Singapore",
    "SX": "Sint Maarten","SK": "Slovakia","SI": "Slovenia","SB": "Solomon Islands","SO": "Somalia","ZA": "South Africa",
    "GS": "South Georgia","SS": "South Sudan","ES": "Spain","LK": "Sri Lanka","SD": "Sudan","SR": "Suriname","SE": "Sweden",
    "CH": "Switzerland","SY": "Syria","TW": "Taiwan","TJ": "Tajikistan","TZ": "Tanzania","TH": "Thailand","TL": "Timor-Leste",
    "TG": "Togo","TK": "Tokelau","TO": "Tonga","TT": "Trinidad and Tobago","TN": "Tunisia","TR": "Turkey","TM": "Turkmenistan",
    "TC": "Turks and Caicos","TV": "Tuvalu","UG": "Uganda","UA": "Ukraine","AE": "UAE","GB": "UK","US": "USA",
    "UY": "Uruguay","UZ": "Uzbekistan","VU": "Vanuatu","VA": "Vatican","VE": "Venezuela","VN": "Vietnam",
    "VG": "British Virgin Islands","VI": "US Virgin Islands","WF": "Wallis and Futuna","EH": "Western Sahara",
    "YE": "Yemen","ZM": "Zambia","ZW": "Zimbabwe"
}

# ---------------------------------------------------------
# Extract YouTube channel ID
# ---------------------------------------------------------

def extract_channel_id(url: str) -> str:
    if not url:
        return ""
    parsed = urlparse(url)
    parts = parsed.path.split("/")
    if "channel" in parts:
        idx = parts.index("channel")
        return parts[idx + 1] if idx + 1 < len(parts) else ""
    if parsed.netloc.endswith("music.youtube.com") and "channel" in parts:
        idx = parts.index("channel")
        return parts[idx + 1] if idx + 1 < len(parts) else ""
    if "user" in parts:
        return ""
    if len(parts) > 1 and parts[1].startswith("@"):
        return ""
    return ""


# ---------------------------------------------------------
# Fetch YT URL from MBID
# ---------------------------------------------------------

def fetch_youtube_using_mbid(mbid: str) -> str:
    url = f"https://musicbrainz.org/ws/2/artist/{mbid}?fmt=json&inc=url-rels"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        data = r.json()
        for rel in data.get("relations", []):
            link = rel.get("url", {}).get("resource", "")
            if "youtube.com" in link:
                return extract_channel_id(link)
    except Exception as e:
        with open(ERROR_LOG, "a", encoding="utf-8") as f:
            f.write(f"{mbid}: {e}\n")
    return ""


# ---------------------------------------------------------
# MAIN SCRIPT
# ---------------------------------------------------------

def main():
    for file in os.listdir(WORLD_FOLDER):
        if not file.startswith("artists_") or not file.endswith(".csv"):
            continue

        df = pd.read_csv(os.path.join(WORLD_FOLDER, file), encoding="utf-8")
        print(f"\nProcessing → {file}")

        for _, row in df.iterrows():
            name = row.get("name")
            mbid = row.get("MBID") or row.get("mbid") or ""
            country = str(row.get("country", "")).upper()

            if not mbid:
                continue

            channel_id = fetch_youtube_using_mbid(mbid)
            country_name = COUNTRY_MAP.get(country, country)

            supabase_insert(name, mbid, channel_id, country, country_name)

            print(f"✓ {name} | {channel_id} | {country_name}")
            time.sleep(0.1)


if __name__ == "__main__":
    main()

import argparse
import csv
import html as html_module
import os
import re
from datetime import datetime

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# --- [ 1. ตั้งค่าการเชื่อมต่อ GLPI - ดึงค่าจาก Environment Variables เพื่อความปลอดภัย ] ---
GLPI_URL = os.environ.get("GLPI_URL", "https://asset.thaismilebus.com/glpi/apirest.php")
APP_TOKEN = os.environ.get("GLPI_APP_TOKEN", "LhY5ETsrBhMdGsS2By2HhZpTxvVl8OTlxdFykvaK")
USER_TOKEN = os.environ.get("GLPI_USER_TOKEN", "N6DexHruw4mGLh5PUTnCp24jJvXxPGDbseLz9hRx")
TARGET_ENTITY_ID = int(os.environ.get("TARGET_ENTITY_ID", 15))  # ITS Station Request

# --- [ 2. ตั้งค่าไฟล์ปลายทาง (กำหนดเป็น glpi3.csv ตามที่ท่านต้องการ) ] ---
CSV_FILE_PATH = os.environ.get("OUTPUT_CSV_NAME", "glpi3.csv")

HEADERS = {
    "App-Token": APP_TOKEN,
    "Authorization": f"user_token {USER_TOKEN}",
}

FIELD_ID = 2
FIELD_TITLE = 1
FIELD_PRIORITY = 3
FIELD_REQUESTER = 4
FIELD_STATUS = 12
FIELD_TECHNICIAN = 5
FIELD_CATEGORY = 7
FIELD_LOCATION = 83
FIELD_ASSOCIATED = 13
FIELD_OPENING = 15
FIELD_LAST_UPDATE = 19
FIELD_CLOSING = 16
FIELD_RESOLUTION = 17
FIELD_SLA = 30
FIELD_TIME_TO_RESOLVE = 18
FIELD_TIME_TO_RESOLVE_PROGRESS = 151
FIELD_TIME_EXCEEDED = 82
FIELD_ENTITY = 80

CSV_HEADERS = [
    "ID",
    "Title",
    "Priority",
    "Requester - Requester",
    "Status",
    "Assigned To - Technician",
    "Category",
    "Locations",
    "Associated Elements",
    "Opening Date",
    "Last Update",
    "Closing Date",
    "Resolution Date",
    "SLA - SLA Time to Resolve",
    "Time to Resolve + Progress",
    "Time to resolve exceeded",
]

PRIORITY_MAP = {
    1: "Very Low",
    2: "Low",
    3: "Medium",
    4: "High",
    5: "Very High",
    6: "Major",
}

STATUS_MAP = {
    1: "New",
    2: "Processing (assigned)",
    3: "Processing (planned)",
    4: "Pending",
    5: "Solved",
    6: "Closed",
}

BATCH_SIZE_DEFAULT = 1000
_BR_MARKER = "\x00BR\x00"


def build_http_session(headers):
    """Connection pooling + retries for faster, more stable bulk export."""
    session = requests.Session()
    session.headers.update(headers)
    retry = Retry(
        total=3,
        backoff_factor=0.4,
        status_forcelist=(429, 500, 502, 503, 504),
    )
    adapter = HTTPAdapter(pool_connections=8, pool_maxsize=8, max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def display_fields(with_progress):
    return [
        FIELD_ID,
        FIELD_TITLE,
        FIELD_PRIORITY,
        FIELD_REQUESTER,
        FIELD_STATUS,
        FIELD_TECHNICIAN,
        FIELD_CATEGORY,
        FIELD_LOCATION,
        FIELD_ASSOCIATED,
        FIELD_OPENING,
        FIELD_LAST_UPDATE,
        FIELD_CLOSING,
        FIELD_RESOLUTION,
        FIELD_SLA,
        FIELD_TIME_TO_RESOLVE_PROGRESS if with_progress else FIELD_TIME_TO_RESOLVE,
        FIELD_TIME_EXCEEDED,
    ]


def clean_date_format(date_str):
    if not date_str or str(date_str).strip().upper() == "NULL":
        return ""
    text = str(date_str).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            dt = datetime.strptime(text, fmt)
            return dt.strftime("%d-%m-%Y %H:%M")
        except ValueError:
            continue
    return text


def format_dates_in_text(value):
    if not value:
        return ""

    def repl(match):
        return clean_date_format(match.group(0))

    return re.sub(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?", repl, str(value))


def format_progress_field(value):
    if not value:
        return ""
    text = format_dates_in_text(value)
    text = text.replace("<br />", "\n").replace("<br/>", "\n").replace("<br>", "\n")
    return text


def format_ticket_id(raw_id):
    try:
        return f"{int(str(raw_id).replace(',', '').strip()):,}"
    except (TypeError, ValueError):
        return str(raw_id or "")


def map_priority(raw):
    if raw is None or raw == "":
        return ""
    if str(raw).isdigit():
        return PRIORITY_MAP.get(int(raw), str(raw))
    return str(raw)


def map_status(raw):
    if raw is None or raw == "":
        return ""
    if str(raw).isdigit():
        return STATUS_MAP.get(int(raw), str(raw))
    return str(raw)


def map_exceeded(raw):
    if raw in (1, "1", True, "Yes", "yes"):
        return "Yes"
    return "No"


def cell(raw):
    if raw is None:
        return ""
    text = str(raw).strip()
    if text.upper() == "NULL":
        return ""
    return text


def html_cell_to_text(fragment):
    """Strip GLPI search HTML but keep <br> like the native CSV export."""
    if not fragment:
        return ""
    s = str(fragment)
    s = re.sub(r"(?i)<br\s*/?>", _BR_MARKER, s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html_module.unescape(s)
    s = s.replace(_BR_MARKER, " <br> ")
    s = re.sub(r"[ \t]+", " ", s).strip()
    return s


def extract_user_id_from_html(fragment):
    """Pull users_id from GLPI search HTML (giveItems) when raw search value is opaque."""
    if not fragment:
        return None
    s = str(fragment)
    patterns = (
        r"/front/user\.form\.php\?[^\"'>]*\bid=(\d+)",
        r"/User/(\d+)(?:\b|[\"'])",
        r"users_id['\"]?\s*[:=]\s*['\"]?(\d+)",
        r"data-users_id=['\"](\d+)['\"]",
    )
    for pat in patterns:
        m = re.search(pat, s, re.I)
        if m:
            return m.group(1)
    return None


def format_user_for_csv(data):
    """Match GLPI ticket export: 'First(nick) Last' when firstname/realname are set."""
    if not data:
        return ""
    fn = (data.get("firstname") or "").strip()
    ln = (data.get("realname") or "").strip()
    if fn and ln:
        return f"{fn} {ln}".strip()
    if fn:
        return fn
    if ln:
        return ln
    return (
        (data.get("friendlyname") or data.get("completename") or data.get("name") or "")
        .strip()
    )


def normalize_associated_plate(text):
    """
    UI / giveItems strings add 'Serial Number:', '<br>', '//', etc.
    Reference export (glpi.csv) keeps a short plate token: '16-7629 -'.
    """
    if not text:
        return ""
    s = str(text)
    s = re.sub(r"(?i)<br\s*/?>", " ", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html_module.unescape(s)
    s = s.replace("//", " ")
    for marker in ("Serial Number:", "Inventory/Asset Number:"):
        if marker in s:
            s = s.split(marker, 1)[0]
    s = re.sub(r"\s+", " ", s).strip()
    m = re.match(r"^(\d{2}-\d{4})\s*-\s*", s)
    if m:
        return f"{m.group(1)} -"
    m = re.search(r"(\d{2}-\d{4})\s*-\s*", s)
    if m:
        return f"{m.group(1)} -"
    m = re.match(r"^(\d{2}-\d{4})\s*$", s)
    if m:
        return f"{m.group(1)} -"
    return s.strip()


def display_cell(ticket, html_row, field_id, raw_fallback):
    key = str(field_id)
    if html_row and html_row.get(key):
        parsed = html_cell_to_text(html_row.get(key))
        if parsed:
            return parsed
    return cell(raw_fallback)


def fetch_user_display_name(http, headers, cache, uid):
    try:
        uid = str(int(str(uid).strip()))
    except (TypeError, ValueError):
        return ""
    if uid in cache:
        return cache[uid]
    try:
        r = http.get(f"{GLPI_URL}/User/{uid}", headers=headers, timeout=60)
        r.raise_for_status()
        data = r.json()
    except (requests.RequestException, ValueError, KeyError):
        cache[uid] = ""
        return ""
    name = format_user_for_csv(data)
    cache[uid] = name
    return name


def resolve_technician(ticket, html_row, http, headers, user_cache):
    raw = cell(ticket.get(str(FIELD_TECHNICIAN), ""))
    uid = None
    if raw.isdigit():
        uid = raw
    elif html_row and html_row.get(str(FIELD_TECHNICIAN)):
        uid = extract_user_id_from_html(html_row.get(str(FIELD_TECHNICIAN)))

    if uid:
        name = fetch_user_display_name(http, headers, user_cache, uid)
        if name:
            return name

    if raw and not raw.isdigit():
        return raw
    return ""


def resolve_requester(ticket, html_row, http, headers, user_cache):
    raw = cell(ticket.get(str(FIELD_REQUESTER), ""))
    uid = None
    if raw.isdigit():
        uid = raw
    elif html_row and html_row.get(str(FIELD_REQUESTER)):
        uid = extract_user_id_from_html(html_row.get(str(FIELD_REQUESTER)))

    if uid:
        name = fetch_user_display_name(http, headers, user_cache, uid)
        if name:
            return name

    if raw and not raw.isdigit():
        return raw
    return ""


def resolve_associated_elements(ticket, html_row):
    raw = cell(ticket.get(str(FIELD_ASSOCIATED), ""))
    blob = ""
    if html_row and html_row.get(str(FIELD_ASSOCIATED)):
        blob = str(html_row[str(FIELD_ASSOCIATED)])

    if raw.isdigit() and blob:
        base = html_cell_to_text(blob)
    elif blob and (raw.isdigit() or len(raw) > 40 or "Serial Number" in raw):
        base = html_cell_to_text(blob)
    elif raw:
        base = html_cell_to_text(raw)
    else:
        base = html_cell_to_text(blob)
    return normalize_associated_plate(base)


def fetch_location_name(http, headers, cache, raw_value):
    text = cell(raw_value)
    if not text.isdigit():
        return text
    lid = text
    if lid in cache:
        return cache[lid]
    try:
        r = http.get(f"{GLPI_URL}/Location/{lid}", headers=headers, timeout=60)
        r.raise_for_status()
        data = r.json()
    except (requests.RequestException, ValueError, KeyError):
        cache[lid] = text
        return text

    name = data.get("completename") or data.get("name") or text
    cache[lid] = str(name).strip()
    return cache[lid]


def build_search_params(offset, limit, with_progress):
    params = {
        "sort": str(FIELD_ID),
        "order": "DESC",
        "range": f"{offset}-{offset + limit - 1}",
        "expand_dropdowns": "true",
        "giveItems": "true",
        "is_deleted": "0",
    }
    params["criteria[0][link]"] = "AND"
    params["criteria[0][field]"] = str(FIELD_ENTITY)
    params["criteria[0][searchtype]"] = "equals"
    params["criteria[0][value]"] = str(TARGET_ENTITY_ID)

    for index, field_id in enumerate(display_fields(with_progress)):
        params[f"forcedisplay[{index}]"] = str(field_id)

    return params


def ticket_row(ticket, html_row, with_progress, http, headers, user_cache, location_cache):
    progress_key = str(
        FIELD_TIME_TO_RESOLVE_PROGRESS if with_progress else FIELD_TIME_TO_RESOLVE
    )

    tech = resolve_technician(ticket, html_row, http, headers, user_cache)
    requester = resolve_requester(ticket, html_row, http, headers, user_cache)

    loc = display_cell(
        ticket, html_row, FIELD_LOCATION, ticket.get(str(FIELD_LOCATION), "")
    )
    loc = fetch_location_name(http, headers, location_cache, loc)

    assoc = resolve_associated_elements(ticket, html_row)

    row = [
        format_ticket_id(ticket.get(str(FIELD_ID), "")),
        cell(ticket.get(str(FIELD_TITLE), "")),
        map_priority(ticket.get(str(FIELD_PRIORITY), "")),
        requester,
        map_status(ticket.get(str(FIELD_STATUS), "")),
        tech,
        display_cell(ticket, html_row, FIELD_CATEGORY, ticket.get(str(FIELD_CATEGORY), "")),
        loc,
        assoc,
        clean_date_format(ticket.get(str(FIELD_OPENING), "")),
        clean_date_format(ticket.get(str(FIELD_LAST_UPDATE), "")),
        clean_date_format(ticket.get(str(FIELD_CLOSING), "")),
        clean_date_format(ticket.get(str(FIELD_RESOLUTION), "")),
        display_cell(ticket, html_row, FIELD_SLA, ticket.get(str(FIELD_SLA), "")),
        format_progress_field(ticket.get(progress_key, "")),
        map_exceeded(ticket.get(str(FIELD_TIME_EXCEEDED), "")),
        "",
    ]
    return row


def open_csv_writer():
    file = open(CSV_FILE_PATH, mode="w", newline="", encoding="utf-8")
    writer = csv.writer(
        file,
        delimiter=";",
        quoting=csv.QUOTE_ALL,
        lineterminator="\n",
    )
    writer.writerow(CSV_HEADERS + [""])
    return file, writer


def export_tickets(session_headers, with_progress, batch_size):
    file, writer = open_csv_writer()
    offset = 0
    totalcount = None
    fetched = 0
    user_cache = {}
    location_cache = {}

    mode = "พร้อม % progress (ช้ากว่า)" if with_progress else "แบบเร็ว (ไม่มี % progress)"
    print(f"📥 ดึงตั๋วทั้งหมด — {mode} — หน้าละ {batch_size} รายการ")

    try:
        with build_http_session(session_headers) as http:
            while True:
                params = build_search_params(offset, batch_size, with_progress)
                response = http.get(
                    f"{GLPI_URL}/search/Ticket",
                    params=params,
                    timeout=300,
                )
                response.raise_for_status()
                payload = response.json()

                batch = payload.get("data", [])
                if not batch and isinstance(payload, list):
                    batch = payload

                if totalcount is None:
                    totalcount = int(payload.get("totalcount", len(batch)))

                html_batch = payload.get("data_html") or []
                for index, ticket in enumerate(batch):
                    html_row = html_batch[index] if index < len(html_batch) else None
                    writer.writerow(
                        ticket_row(
                            ticket,
                            html_row,
                            with_progress,
                            http,
                            session_headers,
                            user_cache,
                            location_cache,
                        )
                    )

                file.flush()
                fetched += len(batch)
                print(f"   ...บันทึกแล้ว {fetched:,} / {totalcount:,} รายการ")

                if len(batch) < batch_size or fetched >= totalcount:
                    break

                offset += batch_size
    finally:
        file.close()

    return fetched


def fetch_perfect_csv(with_progress=False, batch_size=BATCH_SIZE_DEFAULT):
    print(f"🔄 เริ่ม export → {CSV_FILE_PATH} (entity {TARGET_ENTITY_ID})...")

    session_headers = dict(HEADERS)
    init_url = (
        f"{GLPI_URL}/initSession"
        f"?id_entity={TARGET_ENTITY_ID}&expand_dropdowns=true"
    )

    try:
        with build_http_session(session_headers) as http:
            session_req = http.get(init_url, timeout=30)
            session_req.raise_for_status()
            session_token = session_req.json()["session_token"]
            session_headers["Session-Token"] = session_token
            http.headers["Session-Token"] = session_token

            print("✅ ล็อกอิน API สำเร็จ")

            count = export_tickets(session_headers, with_progress, batch_size)

            print(f"🎉 Export เสร็จแล้ว — {count:,} รายการ")
            print(f"📁 ไฟล์: {CSV_FILE_PATH}")

            http.get(f"{GLPI_URL}/killSession", timeout=10)

        return True

    except Exception as e:
        print(f"❌ เกิดข้อผิดพลาด: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Export GLPI tickets to CSV")
    parser.add_argument(
        "--with-progress",
        action="store_true",
        help="ใช้ฟิลด์ Time to Resolve + Progress แบบเต็ม (มี % ค้าง) แต่ช้ามาก",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=BATCH_SIZE_DEFAULT,
        metavar="N",
        help=f"จำนวนตั๋วต่อคำขอ search (ค่าเริ่มต้น {BATCH_SIZE_DEFAULT})",
    )
    args = parser.parse_args()
    batch_size = max(50, min(int(args.batch_size), 2500))
    if batch_size != args.batch_size:
        print(f"⚠️  ปรับ batch-size เป็น {batch_size} (อนุญาต 50–2500)")
    fetch_perfect_csv(with_progress=args.with_progress, batch_size=batch_size)


if __name__ == "__main__":
    main()
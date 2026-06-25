#!/usr/bin/env python3
"""
Scrapes Delco Swimming & Diving League varsity meet results for Springfield
Swim Club (SSC), pulls the linked PDF for each Springfield meet, finds every
line for Luca Sciamanna, and updates data/meets.json with his events/times.

Run manually: python3 scripts/scrape.py
Run by CI: .github/workflows/update-and-deploy.yml (Saturdays at 5pm Eastern)
"""
import json
import re
import sys
from pathlib import Path

import requests
import pdfplumber
from bs4 import BeautifulSoup
from io import BytesIO

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "meets.json"
OVERRIDES_FILE = ROOT / "data" / "manual-overrides.json"

LEAGUE_PAGE = "https://www.delcoswimmingdivingleague.com/page/swimming/custom-page"
BASE_URL = "https://www.delcoswimmingdivingleague.com"
SWIMMER_NAME = "Luca Sciamanna"
SSC_HOME_NAME = "Springfield"  # as it appears in the league's table (not "Springfield CC")

# A browser User-Agent is required, the league site 403s on default requests UA.
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

EVENT_HEADER_RE = re.compile(r"^\(?Event\s+(\d+)\s+(.+?)\)?$")
SCIAMANNA_LINE_RE = re.compile(
    r"^(?P<place>\d+|---|\*\d+)\s+Sciamanna,\s*Luca\s+(?P<age>\d+)\s+.*?"
    r"(?P<seed>NT|\d+:\d+\.\d+|\d+\.\d+)\s+"
    r"(?P<finals>[xXJ]*(?:\d+:\d+\.\d+|\d+\.\d+)|DQ)"
    r"(?:\s+(?P<points>\d+))?\s*$"
)


def fetch_league_meets():
    """Parse the Meet Results table and return every Springfield (not CC) meet row."""
    resp = requests.get(LEAGUE_PAGE, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    meets = []
    for row in soup.select("table tr"):
        cells = row.find_all("td")
        if len(cells) != 5:
            continue
        away, home = cells[1].get_text(strip=True), cells[2].get_text(strip=True)
        if SSC_HOME_NAME not in (away, home):
            continue
        if "Springfield CC" in (away, home):
            continue
        link = cells[3].find("a")
        if not link or not link.get("href"):
            continue
        pdf_url = link["href"]
        if pdf_url.startswith("/"):
            pdf_url = BASE_URL + pdf_url
        meets.append({
            "away_team": away,
            "home_team": home,
            "score_text": cells[4].get_text(strip=True),
            "pdf_url": pdf_url,
        })
    return meets


def parse_score(score_text, home_team, away_team):
    """'Springfield 246-Ridley Twp 230' -> (ssc_score, opponent_score, opponent_name, result)."""
    numbers = re.findall(r"\d+", score_text)
    names = re.split(r"[-–]", re.sub(r"\d+", "", score_text))
    if len(numbers) != 2 or len(names) != 2:
        return None
    ssc_is_home = home_team == SSC_HOME_NAME
    home_score, away_score = int(numbers[0]), int(numbers[1])
    ssc_score = home_score if ssc_is_home else away_score
    opp_score = away_score if ssc_is_home else home_score
    opponent = away_team if ssc_is_home else home_team
    result = "W" if ssc_score > opp_score else ("L" if ssc_score < opp_score else "T")
    return ssc_score, opp_score, opponent, result, ssc_is_home


def download_pdf_text(pdf_url):
    resp = requests.get(pdf_url, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    pages_text = []
    with pdfplumber.open(BytesIO(resp.content)) as pdf:
        for page in pdf.pages:
            pages_text.append(page.extract_text() or "")
    return "\n".join(pages_text)


def parse_meet_date(pdf_text):
    match = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", pdf_text)
    if not match:
        return None
    month, day, year = match.groups()
    return f"{year}-{int(month):02d}-{int(day):02d}"


def extract_luca_events(pdf_text):
    """Walk the PDF text line by line, tracking the current event header,
    and pull out every row belonging to Luca Sciamanna."""
    events = []
    current_event = None

    lines = [l.strip() for l in pdf_text.splitlines() if l.strip()]
    for i, line in enumerate(lines):
        header_match = EVENT_HEADER_RE.match(line)
        if header_match:
            current_event = (int(header_match.group(1)), header_match.group(2).replace("­", ""))
            continue

        if "Sciamanna, Luca" not in line:
            continue

        m = SCIAMANNA_LINE_RE.match(line)
        if not m or current_event is None:
            print(f"WARNING: could not parse Luca line: {line!r}", file=sys.stderr)
            continue

        finals_raw = m.group("finals")
        dq = finals_raw == "DQ"
        exhibition = finals_raw.lower().startswith("x") if not dq else False
        time_clean = None if dq else re.sub(r"^[xXJ]+", "", finals_raw)

        # The DQ reason is printed on the line immediately following the row.
        dq_reason = None
        if dq and i + 1 < len(lines) and not EVENT_HEADER_RE.match(lines[i + 1]) and "Sciamanna" not in lines[i + 1]:
            dq_reason = lines[i + 1]

        event_number, event_name = current_event
        stroke_match = re.search(r"(Freestyle|Backstroke|Breaststroke|Butterfly|Medley)", event_name)
        distance_match = re.search(r"(\d+)\s*Yard", event_name)

        events.append({
            "eventNumber": event_number,
            "name": event_name,
            "stroke": stroke_match.group(1) if stroke_match else None,
            "distance": int(distance_match.group(1)) if distance_match else None,
            "seedTime": m.group("seed"),
            "time": time_clean,
            "timeSeconds": time_to_seconds(time_clean) if time_clean else None,
            "place": None if m.group("place") in ("---",) else int(re.sub(r"\D", "", m.group("place"))),
            "points": int(m.group("points")) if m.group("points") else 0,
            "exhibition": exhibition,
            "dq": dq,
            "dqReason": dq_reason,
            "timeSource": "official",
        })

    return events


def time_to_seconds(time_str):
    if ":" in time_str:
        minutes, seconds = time_str.split(":")
        return round(int(minutes) * 60 + float(seconds), 2)
    return round(float(time_str), 2)


def apply_overrides(meet_id, events):
    overrides = json.loads(OVERRIDES_FILE.read_text()) if OVERRIDES_FILE.exists() else {}
    meet_overrides = overrides.get(meet_id, {})
    for event in events:
        override = meet_overrides.get(str(event["eventNumber"]))
        if not override:
            continue
        event["time"] = override["time"]
        event["timeSeconds"] = time_to_seconds(override["time"])
        event["timeSource"] = "manual-override"
        event["timeNote"] = override.get("note")
    return events


def recompute_personal_bests(meets):
    """Walk meets oldest-to-newest, flagging the first time a stroke/distance
    combo is beaten as a PR. Events with no recorded time (e.g. unresolved DQs)
    are skipped."""
    meets_sorted = sorted(meets, key=lambda m: m["date"])
    best = {}
    for meet in meets_sorted:
        for event in sorted(meet["events"], key=lambda e: e["eventNumber"]):
            if event.get("timeSeconds") is None:
                event["isPR"] = False
                continue
            key = (event["stroke"], event["distance"])
            current_best = best.get(key)
            is_pr = current_best is None or event["timeSeconds"] < current_best
            event["isPR"] = is_pr
            if is_pr:
                best[key] = event["timeSeconds"]
    return meets_sorted


def build_meet_record(row, pdf_text):
    date = parse_meet_date(pdf_text)
    score = parse_score(row["score_text"], row["home_team"], row["away_team"])
    if not date or not score:
        print(f"WARNING: skipping unparseable meet row: {row}", file=sys.stderr)
        return None
    ssc_score, opp_score, opponent, result, ssc_is_home = score
    meet_id = f"{date}-{re.sub(r'[^a-z0-9]+', '-', opponent.lower()).strip('-')}"

    events = extract_luca_events(pdf_text)
    events = apply_overrides(meet_id, events)

    return {
        "id": meet_id,
        "date": date,
        "meetType": "varsity",
        "homeTeam": row["home_team"],
        "awayTeam": row["away_team"],
        "sscIsHome": ssc_is_home,
        "opponent": opponent,
        "finalScore": {"ssc": ssc_score, "opponent": opp_score},
        "result": result,
        "sourceUrl": LEAGUE_PAGE,
        "resultsPdfUrl": row["pdf_url"],
        "events": events,
    }


def main():
    existing = json.loads(DATA_FILE.read_text()) if DATA_FILE.exists() else {
        "swimmer": SWIMMER_NAME, "team": "Springfield Swim Club", "teamAbbr": "SSC", "meets": [],
    }
    existing_by_id = {m["id"]: m for m in existing["meets"]}

    rows = fetch_league_meets()
    print(f"Found {len(rows)} Springfield meet(s) on the league page.")

    for row in rows:
        try:
            pdf_text = download_pdf_text(row["pdf_url"])
        except requests.RequestException as exc:
            print(f"WARNING: failed to download {row['pdf_url']}: {exc}", file=sys.stderr)
            continue

        record = build_meet_record(row, pdf_text)
        if record is None:
            continue
        if not record["events"]:
            print(f"No Luca Sciamanna results found in {row['pdf_url']}, skipping.")
            continue

        existing_by_id[record["id"]] = record
        print(f"Updated meet {record['id']} ({len(record['events'])} events).")

    existing["meets"] = recompute_personal_bests(list(existing_by_id.values()))
    DATA_FILE.write_text(json.dumps(existing, indent=2) + "\n")
    print(f"Wrote {len(existing['meets'])} meet(s) to {DATA_FILE}.")


if __name__ == "__main__":
    main()

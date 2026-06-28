# Luca Swim Times

A small static site tracking Luca Sciamanna's swim meet results for **Springfield
Swim Club (SSC)**, the "Tiger Sharks," in the Delco Swimming & Diving League
(summer league). Built to keep an 11-12u swimmer motivated by showing his
history, events, times, and personal bests.

## Source of truth

- League meet results page (HTML table of meets + links to PDF results):
  https://www.delcoswimmingdivingleague.com/page/swimming/custom-page
- Each meet links to a HY-TEK Meet Manager results PDF. Springfield's home
  pool is 25-yard ("Springfield" in the league's table — **not** "Springfield CC",
  which is a different, unrelated team in the same league).
- The league page 403s without a browser-like `User-Agent` header — always set one.

## Data model — `data/meets.json`

One JSON file, one record per meet, each with Luca's events embedded. Shape:

```
{
  "swimmer": "Luca Sciamanna",
  "team": "Springfield Swim Club",
  "teamAbbr": "SSC",
  "meets": [
    {
      "id": "<date>-<opponent-slug>",
      "date": "YYYY-MM-DD",       // parsed from the PDF header, not the HTML page (HTML only has "Month Day", no year)
      "meetType": "varsity" | "JV",  // omitted/absent defaults to "varsity" in the UI
      "homeTeam": "...", "awayTeam": "...",
      "sscIsHome": true/false,
      "opponent": "...",
      "finalScore": { "ssc": N, "opponent": N } | null,  // null for meets with no tracked team score (e.g. some JV meets)
      "result": "W" | "L" | "T" | null,
      "sourceUrl": "...", "resultsPdfUrl": "...",  // null when there's no league page/PDF (e.g. JV meets)
      "events": [
        {
          "eventNumber": 22, "name": "Boys 11-12 50 Yard Backstroke",
          "stroke": "Backstroke", "distance": 50, "unit": "y",  // "y" = yards, "m" = meters (SC Meter pools)
          "seedTime": "1:09.65", "time": "59.19", "timeSeconds": 59.19,
          "place": 6, "points": 0,
          "exhibition": true, "dq": false, "dqReason": null,
          "timeSource": "official" | "manual-override" | "manual",
          "isPR": true
        }
      ]
    }
  ]
}
```

`isPR` is recomputed from scratch every scrape run by walking all meets oldest
→ newest and tracking the best `timeSeconds` per `(stroke, distance)`.

## Reading the results PDF correctly

This tripped us up once — keep these straight:

- **Lowercase `x` prefix on a time** (e.g. `x59.19`) = **exhibition entry**, not
  a DQ. Per league rules (Section II "Contestants"), a team may enter more
  swimmers per individual event than can score (3 entries allowed in a 6-lane
  pool, but only some score); the extra entry swims "exhibition" — marked `EX`
  on the official lineup card, rendered as lowercase `x` in the printed
  results. The time is still real and still counts for tracking/PR purposes.
- **Literal `DQ`** in the Finals Time column = an actual disqualification. The
  PDF does **not** publish a time for a DQ swim — only the DQ reason on the
  following line (e.g. "Shoulders past vertical toward breast").
- Date: parse it from the PDF text itself (e.g. `... 9:22 PM 6/20/2026`), not
  from the HTML page's date heading, which omits the year.

## DQ handling — important product decision

We deliberately **do not show DQ status anywhere in the UI**. The goal of this
site is to keep Luca motivated, not to dwell on disqualifications. `dq` and
`dqReason` are kept in `data/meets.json` for the parents' own record-keeping,
but `assets/app.js` never reads or renders them.

If a DQ'd swim actually had a good, known time (e.g. a parent timed it from
the deck), add it to **`data/manual-overrides.json`**, keyed by meet id and
event number:

```json
{
  "<meet-id>": {
    "<eventNumber>": { "time": "1:06.53", "note": "why this override exists" }
  }
}
```

`scripts/scrape.py` applies overrides on every run — the overridden time
becomes the displayed time (`timeSource: "manual-override"`) and is eligible
to be flagged as a PR, regardless of the official DQ. This is the supported
way to correct a result within a meet the scraper controls (one matched by a
current league page row) — don't hand-edit *that* meet's record directly,
since the scraper rebuilds it from the PDF every run and will overwrite it.

## Non-league meets (e.g. JV meets)

`scripts/scrape.py`'s `main()` only adds/overwrites meet `id`s it finds on the
current league page (`existing_by_id[record["id"]] = record`); it never
deletes anything. A meet whose `id` never matches a league row (e.g. an
informal JV meet that isn't posted on the league site) is safe to hand-add
directly to `data/meets.json` — it persists across every future scrape run
untouched. Use `timeSource: "manual"` for hand-entered times, `meetType: "JV"`,
and `finalScore`/`result`/`sourceUrl`/`resultsPdfUrl`: `null` if there's no
official team score or source page. After adding, recompute `isPR` across all
meets (see `recompute_personal_bests` in `scripts/scrape.py`) rather than
hand-setting it.

## Scraper — `scripts/scrape.py`

1. Fetch the league results page, find table rows where home/away team is
   exactly `"Springfield"` (excludes `"Springfield CC"`).
2. Download each linked results PDF, extract text per page with `pdfplumber`.
3. Walk the text tracking the current `Event N ...` header, regex-match any
   line containing `"Sciamanna, Luca"`.
4. Apply `data/manual-overrides.json`, recompute PRs, write `data/meets.json`.

Run locally: `pip install -r scripts/requirements.txt && python3 scripts/scrape.py`

## Hosting

GitHub Pages, deployed via `.github/workflows/update-and-deploy.yml`:
- Runs the scraper, commits `data/meets.json` if it changed.
- Publishes the repo root as a Pages artifact (`index.html` + `assets/` +
  `data/meets.json` are all served as static files).
- Scheduled Saturdays at 5pm Eastern (`cron: 0 21 * * 6` = 5pm EDT; GitHub
  Actions cron is fixed UTC and doesn't observe DST, so this drifts to 4pm
  during EST months — fine for a summer-only league).
- Can also be triggered manually via `workflow_dispatch`, or runs automatically
  on every push to `main`.
- Repo is public (required for free GitHub Pages); the underlying meet data
  is already public on the league's site, so there's no privacy downside.

## Frontend

Plain HTML/CSS/JS, no build step or framework — `index.html`, `assets/style.css`,
`assets/app.js`. Ocean/tiger-shark themed (Springfield Swim Club's mascot).
The shark graphic (`assets/tiger-shark.svg`) is an original stylized SVG, not
sourced from the team's actual logo/branding.

## Future scope

Currently scoped to Luca only, SSC summer league only. The data model
(`meets.json` keyed by swimmer) and scraper are written to extend to other
swimmers/teams later, but don't build that out until asked.

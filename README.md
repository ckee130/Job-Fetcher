# Job Fetcher

Manual CLI that pulls **new** remote US jobs from Hiring Cafe and Built In using your saved filters, then prints a completion summary (and an optional desktop notification).

No cron — run it yourself (e.g. 3×/day). Re-runs are safe: already-seen job links are skipped via `data/seen-jobs.json`.

## Setup

```bash
cd ~/Desktop/job-fetcher
npm install
cp .env.example .env
# optional: set PROXY_URL=http://user:pass@host:port
```

## Run

```bash
npm run fetch                 # both sources
npm run fetch:hiringcafe      # Hiring Cafe only
npm run fetch:builtin         # Built In only
```

## Filters (hard-coded from your URLs)

- **Hiring Cafe:** US + Remote, last 2 days, Software/Data/Engineering/IT, 5–10 YoE, IC, no clearance/certs
- **Built In:** Remote engineering (software / devops / QA / security / automation), mid–expert, updated in last 1 day, USA

## Output

| Path | What |
|------|------|
| `output/new-jobs-<timestamp>.json` | New jobs this run |
| `output/latest-new-jobs.json` | Same, always overwritten |
| `output/latest-all-fetched.json` | All listings fetched this run (before “seen” filter) |
| `data/seen-jobs.json` | Local dedupe store — delete to reset |

Each job record:

```json
{
  "company": "MongoDB",
  "title": "Software Engineer 3, Networking & Observability",
  "jobLink": "https://builtin.com/job/…",
  "source": "builtin"
}
```

## Alerts

When a run finishes you get:

1. A colored terminal summary (counts, errors, first new jobs)
2. A desktop notification via `notify-send` if `NOTIFY=1` (default)

## Env

See `.env.example`:

- `PROXY_URL` — optional proxy
- `MAX_PAGES` — cap pages per source while testing (`0` = all)
- `PAGE_DELAY_MS` — delay between page requests
- `NOTIFY` — desktop notification on/off

## Next (not in this phase)

Google Sheets append for new jobs.

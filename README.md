# Job Fetcher

Manual CLI that pulls **new** remote US jobs from Hiring Cafe and Built In using your saved filters, appends them to Google Sheets, and sends an optional desktop notification.

No cron — run it yourself (e.g. 3×/day). Re-runs are safe: already-seen job links are skipped via `data/seen-jobs.json`.

## Setup

```bash
cd ~/Desktop/job-fetcher
npm install
cp .env.example .env
# optional: set PROXY_URL=http://user:pass@host:port
```

### Google Sheets

1. In Google Cloud, create a service account and enable the **Google Sheets API**
2. Download the JSON key → save as `credentials/google-service-account.json`
3. Create a spreadsheet (or use an existing one) and share it with the service account email as **Editor**
4. In `.env` set:
   - `GOOGLE_SPREADSHEET_ID` — from the sheet URL (`/d/<ID>/edit`)
   - `GOOGLE_SHEET_NAME` — tab name (default `Jobs`)
   - `GOOGLE_SERVICE_ACCOUNT_FILE` — path to the JSON key

New jobs are appended as: **Company | Role | Job Link | Source**

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
| Google Sheet | New jobs appended each run |
| `output/new-jobs-<timestamp>.json` | Local backup of new jobs |
| `output/latest-new-jobs.json` | Same, always overwritten |
| `data/seen-jobs.json` | Local dedupe store — delete to reset |

## Env

See `.env.example`:

- `PROXY_URL` — optional proxy
- `MAX_PAGES` — cap pages per source while testing (`0` = all)
- `PAGE_DELAY_MS` — delay between page requests
- `NOTIFY` — desktop notification on/off
- `GOOGLE_SPREADSHEET_ID` / `GOOGLE_SHEET_NAME` / `GOOGLE_SERVICE_ACCOUNT_FILE` — Sheets append

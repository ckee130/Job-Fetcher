# Job Fetcher

Manual CLI that pulls **new** remote jobs from Built In per **profile**, appends them to Google Sheets, and sends an optional desktop notification.

Three profiles: **Clinton**, **Nathan**, **Andrei** — each with its own search filters, Google Sheet tab, and CV folder.

## Setup

```bash
cd ~/Desktop/job-fetcher
npm install
cp .env.example .env
# set GOOGLE_SPREADSHEET_ID, credentials, CV_DIR, optional PROFILE default
```

### Google Sheets

One spreadsheet; each profile writes to a **tab named after the profile** (Clinton, Nathan, Andrei). Create those tabs and share the sheet with your service account.

## Run

Pick a profile:

```bash
npm run fetch:clinton
npm run fetch:nathan
npm run fetch:andrei
```

Or pass `--profile` / set `PROFILE` in `.env`:

```bash
npm run fetch -- --profile=Nathan
```

## Profiles

| Profile | Built In (3 searches each) |
|---------|----------------------------|
| **Clinton** | USA: data-engineering + engineering + AI/ML (senior/expert-leader) |
| **Nathan** | USA: data-engineering + engineering + AI/ML (senior) |
| **Andrei** | GBR: AI/ML + engineering + data-engineering (senior) |

Filters are defined in `src/profiles.ts`.

## Pipeline

1. Fetch listings (Built In employer URLs only for jobs that pass filters)
2. Within-run dedupe (same company / apply URL across Built In searches)
3. Title filter (manager, director, designer, VP, owner)
4. CV folder check → sheet company check (one row per company)
5. Upload to profile tab with date

## Output

| Path | What |
|------|------|
| Google Sheet tab `{profile}` | New jobs appended each run |
| `output/latest-new-jobs.json` | Local backup of last upload |

## Env

- `PROFILE` — default profile if `--profile` omitted
- `GOOGLE_SPREADSHEET_ID` / `GOOGLE_SERVICE_ACCOUNT_FILE` — shared spreadsheet
- `CV_DIR` — `D:\remote\CV\{sheet}` where `{sheet}` = profile name
- `PROXY_URL`, `MAX_PAGES`, `PAGE_DELAY_MS`, `NOTIFY`

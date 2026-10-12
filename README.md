# Job Fetcher

Manual CLI that pulls **new** remote jobs from **Built In** and **JobRight.ai** per **profile**, appends them to Google Sheets, and sends an optional desktop notification.

Five profiles: **Clinton**, **Nathan**, **Andrei**, **Blake**, **Kami** — each with its own Built In search filters and Google Sheet tab (most also use a local CV folder). JobRight recommendations come from one shared account (filters live on JobRight).

## Setup

```bash
cd ~/Desktop/job-fetcher
npm install
cp .env.example .env
# set GOOGLE_SPREADSHEET_ID, credentials, CV_DIR, JOBRIGHT_EMAIL/PASSWORD, optional PROFILE default
```

### Google Sheets

One spreadsheet; each profile writes to a **tab named after the profile** (Clinton, Nathan, Andrei, Blake, Kami). Create those tabs and share the sheet with your service account.

### JobRight

Set `JOBRIGHT_EMAIL` + `JOBRIGHT_PASSWORD` (or `JOBRIGHT_SESSION_ID`). Configure your job filters once in the JobRight UI (Confirm) — every profile run fetches that account’s recommendations.

## Run

Pick a profile:

```bash
npm run fetch:clinton
npm run fetch:nathan
npm run fetch:andrei
npm run fetch:blake
npm run fetch:kami
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
| **Blake** | Same searches as Clinton; only uploads companies that already have a CV under Clinton or Nathan |
| **Kami** | Same searches as Nathan; sheet-only company dedupe (no local CV folder check) |

Filters are defined in `src/profiles.ts`. JobRight uses the account’s saved criteria for all profiles.

## Pipeline

1. Fetch Built In listings + JobRight recommendations
2. Within-run dedupe (same company / apply URL across sources)
3. Title filter (manager, director, designer, VP, owner)
4. CV folder check (skipped for Kami) → peer CV check (Blake only) → sheet company check (one row per company)
5. Resolve Built In employer apply URLs for jobs that will upload
6. Upload to profile tab with date

## Output

| Path | What |
|------|------|
| Google Sheet tab `{profile}` | New jobs appended each run |
| `output/latest-new-jobs.json` | Local backup of last upload |
| `data/jobright-session.json` | Cached JobRight `SESSION_ID` |

## Env

- `PROFILE` — default profile if `--profile` omitted
- `GOOGLE_SPREADSHEET_ID` / `GOOGLE_SERVICE_ACCOUNT_FILE` — shared spreadsheet
- `CV_DIR` — `D:\remote\CV\{sheet}` where `{sheet}` = profile name
- `JOBRIGHT_EMAIL` / `JOBRIGHT_PASSWORD` / `JOBRIGHT_SESSION_ID`
- `JOBRIGHT_MAX_JOBS`, `JOBRIGHT_PAGE_DELAY_MS`
- `PROXY_URL`, `MAX_PAGES`, `PAGE_DELAY_MS`, `NOTIFY`

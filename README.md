# Job Fetcher

Manual CLI that pulls **new** remote jobs from **Hiring Cafe**, **Built In**, and **JobRight.ai** per **profile**, appends them to Google Sheets, and sends an optional desktop notification.

Profiles: **Clinton**, **Nathan**, **Blake**, **Eric**, **Jay**, **Daniel**, **Luke**. JobRight uses a shared account for most profiles; Daniel (`DANIEL_JOBRIGHT_*`) and Luke (`LUKE_JOBRIGHT_*`) have their own.

## Setup

```bash
cd ~/Desktop/job-fetcher
npm install
cp .env.example .env
# set GOOGLE_SPREADSHEET_ID, credentials, CV_DIR, JOBRIGHT_EMAIL/PASSWORD, optional PROFILE default
```

### Google Sheets

One spreadsheet; each profile writes to a **tab named after the profile**. Create those tabs and share the sheet with your service account. Columns: Company, Role, Job Link, Source, Date, **Type** (Full-time / Contract / … when the source provides it).

### JobRight

Set `JOBRIGHT_EMAIL` + `JOBRIGHT_PASSWORD` (or `JOBRIGHT_SESSION_ID`) for most profiles. **Daniel** uses `DANIEL_JOBRIGHT_EMAIL` / `DANIEL_JOBRIGHT_PASSWORD`. **Luke** uses `LUKE_JOBRIGHT_EMAIL` / `LUKE_JOBRIGHT_PASSWORD`. Each account has its own session file. Configure filters in each JobRight UI (Confirm) — recommendations follow that account.

### Hiring Cafe

Uses a **headed Chromium** window (Playwright). If a bot check appears, complete it in the browser. The fetcher starts **without** a proxy; if the check is still up after `HIRINGCAFE_PROXY_FALLBACK_MS` (default 60s), it reopens **via `PROXY_URL`**. Set `HIRINGCAFE_USE_PROXY=1` to use the proxy from the start.

## Run

```bash
npm run fetch:clinton
npm run fetch:nathan
npm run fetch:blake
npm run fetch:eric
npm run fetch:jay
npm run fetch:daniel
npm run fetch:luke
```

Or pass `--profile` / set `PROFILE` in `.env`:

```bash
npm run fetch -- --profile=Nathan
```

Run **one source** with `--src=` / `--source=` (`hc` | `bi` | `jr`, or `hiringcafe` | `builtin` | `jobright`). Omit for all three:

```bash
npm run fetch:clinton -- --src=jr
npm run fetch:clinton -- --src=hc
npm run fetch:clinton -- --src=bi
```

## Profiles

| Profile | Local path | Match |
|---------|------------|--------|
| **Clinton / Nathan / Blake** | `D:\Remote\CV\{profile}` | CV **filename** contains company |
| **Eric / Jay / Daniel / Luke** | `E:\Data\RM\US Resume\Resumes\{profile}` | Company **subfolder** exists |

| Profile | Search notes |
|---------|----------------|
| **Clinton** | US remote; YoE 5–10; Built In senior/expert-leader |
| **Nathan** | US remote; YoE 4–8; Built In senior |
| **Blake** | Same as Clinton; skip same company+role already in Clinton/Nathan CV filenames (peer sheets not checked) |
| **Luke** | Same searches as Clinton; local-only dedupe (company subfolder, sheet not checked) |
| **Eric / Jay / Daniel** | Same as Nathan; local-only dedupe |

Example: Jay + company `ABC` → skip if `E:\Data\RM\US Resume\Resumes\Jay\ABC` exists.

## Pipeline

1. Fetch Hiring Cafe → Built In → JobRight (Hiring Cafe wins within-run company/URL dedupe)
2. Within-run dedupe (same company / apply URL across sources)
3. Title filter (manager, director, designer, VP, owner)
4. Local company check (file or subfolder) → Blake peer CV company+role check → sheet company check (skipped for Eric/Jay/Daniel/Luke)
5. Resolve Built In employer apply URLs for jobs that will upload
6. Upload to profile tab with date

## Env

- `PROFILE` — default profile if `--profile` omitted
- `GOOGLE_SPREADSHEET_ID` / `GOOGLE_SERVICE_ACCOUNT_FILE` — shared spreadsheet
- `CV_DIR` — fallback `D:\Remote\CV\{sheet}` (profiles also set explicit roots in code)
- `JOBRIGHT_EMAIL` / `JOBRIGHT_PASSWORD` / `JOBRIGHT_SESSION_ID`
- `DANIEL_JOBRIGHT_EMAIL` / `DANIEL_JOBRIGHT_PASSWORD` / `DANIEL_JOBRIGHT_SESSION_ID` (Daniel only)
- `LUKE_JOBRIGHT_EMAIL` / `LUKE_JOBRIGHT_PASSWORD` / `LUKE_JOBRIGHT_SESSION_ID` (Luke only)
- `BUILTIN_LOGIN_WAIT_MS`, `BUILTIN_LOGIN_ATTEMPTS`, `BUILTIN_APPLY_CONCURRENCY`
- `PROXY_URL`, `MAX_PAGES`, `PAGE_DELAY_MS`, `NOTIFY`

# Job Fetcher

Chrome extension that reads the job search already open in the browser (Hiring Cafe, Built In, JobRight, Dice, or Indeed), checks duplicates, and appends new rows to Google Sheets.

Profiles: **Clinton**, **Nathan**, **Blake**, **Patrick**, **Eric**, **Jay**, **Daniel**, **Luke**, **Stout**. Pick the profile in the extension. The open page is the search.

## Setup

```bash
cd ~/Desktop/job-fetcher
npm install
cp .env.example .env
# set GOOGLE_SPREADSHEET_ID and GOOGLE_SERVICE_ACCOUNT_FILE
```

### Google Sheets

One spreadsheet; each profile writes to a **tab named after the profile**. Create those tabs and share the sheet with your service account. Columns: Company, Role, Job Link, Source, Date, **Type** (Full-time / Contract / … when the page provides it).

## Run

```bash
npm run extension
```

Leave that window open. It prints `http://127.0.0.1:3921` and a token (saved in `data/extension-token.txt` unless `EXTENSION_TOKEN` is set).

1. Chrome → `chrome://extensions` → Developer mode → Load unpacked → the `extension` folder.
2. Open the extension and paste the token.
3. On the job site, sign in if asked, set the filters, and open page 1 of the results.
4. Click the extension, pick the profile, choose **Job sites** (All, or one or more ATS hosts), and choose **Collect**. The server address and token are under **Connection**.

Duplicate checks run before any job page is opened. Built In and Hiring Cafe employer links are then loaded only for jobs that passed those checks. Dice keeps the Dice job link. Rows that are still only a Built In link are not uploaded. Clinton and Nathan then skip a job whose job link is already on each other’s sheet. If specific job sites are selected, only matching employer links are uploaded (**All** keeps every link). New rows go to the sheet tab with that profile’s name.

## Profiles

| Profile | Local path | Match |
|---------|------------|--------|
| **Clinton / Nathan / Blake / Patrick** | `D:\Remote\CV\{profile}` | CV **filename** contains company |
| **Eric / Jay / Luke** | `E:\Data\RM\US Resume\Resumes\{profile}` | Company **subfolder** exists |
| **Daniel / Stout** | — | **Sheet only** (company already on that profile’s tab) |

Blake and Patrick each skip a company already on their own local CV or sheet. Clinton and Nathan skip a job when the same job link is already on each other’s sheet (Job Link column only). Neither checks Blake’s or Patrick’s sheet. Eric, Jay, Daniel, and Luke skip the sheet company check and use the local folder only. Job site filtering (Greenhouse, Ashby, Lever, SmartRecruiters, Workable, Workday, Rippling, or All) is chosen in the extension for every profile.

Example: Jay + company `ABC` → skip if `E:\Data\RM\US Resume\Resumes\Jay\ABC` exists.

## Pipeline

1. Read the open search, including later pages
2. Within-run dedupe (same company / apply URL)
3. Title filter (manager, director, designer, researcher, leader, VP, owner, security)
4. Local company check (file or subfolder; skipped for Daniel/Stout) → sheet company check (skipped for Eric/Jay/Luke)
5. Resolve Built In and Hiring Cafe employer links for jobs that will upload
6. Job site filter (if not All): keep matching employer hosts only · Clinton↔Nathan: skip a job link already on the other sheet · then upload to the profile tab with the date

## Env

- `GOOGLE_SPREADSHEET_ID` / `GOOGLE_SERVICE_ACCOUNT_FILE` — shared spreadsheet
- `CV_DIR` — fallback `D:\Remote\CV\{sheet}` (profiles also set explicit roots in code)
- `EXTENSION_PORT` (default 3921), `EXTENSION_TOKEN` (optional; otherwise generated on `npm run extension`)

import { spawnSync } from "node:child_process";
import { config } from "./config.js";
import type { JobSource, RunSummary } from "./types.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

const SOURCE_ORDER: JobSource[] = ["hiringcafe", "builtin", "jobright"];

export function printRunSummary(summary: RunSummary): void {
  const hasErrors =
    SOURCE_ORDER.some((s) => Boolean(summary.bySource[s]?.error)) ||
    Boolean(summary.sheets?.error);
  const tone = hasErrors ? YELLOW : summary.newJobs.length > 0 ? GREEN : CYAN;

  console.log("");
  console.log(`${tone}${BOLD}${summary.newJobs.length} new job(s)${RESET}`);
  if (summary.skippedWithinRun) {
    console.log(`  skipped (duplicate within run): ${summary.skippedWithinRun}`);
  }
  if (summary.skippedByTitle) {
    console.log(`  skipped by title filter: ${summary.skippedByTitle}`);
  }
  if (summary.skippedByCv) {
    console.log(`  skipped (CV file exists for company): ${summary.skippedByCv}`);
  }
  if (summary.skippedByPeerCv) {
    console.log(
      `  skipped (company not in peer CV folder): ${summary.skippedByPeerCv}`,
    );
  }
  if (summary.skippedByPeerRole) {
    console.log(
      `  skipped (same company+role on peer sheet): ${summary.skippedByPeerRole}`,
    );
  }
  if (summary.skippedDuplicates) {
    console.log(`  skipped (company already on sheet): ${summary.skippedDuplicates}`);
  }

  for (const source of SOURCE_ORDER) {
    const s = summary.bySource[source];
    if (!s) continue;
    console.log(
      `  ${source}: fetched ${s.fetched}, new ${s.newCount}, pages ${s.pagesFetched}`,
    );
    if (s.error) {
      console.log(`    ${RED}${s.error}${RESET}`);
    }
  }

  if (summary.sheets?.skipped) {
    console.log(
      `${YELLOW}  Google Sheets: not configured (set GOOGLE_SPREADSHEET_ID + GOOGLE_SERVICE_ACCOUNT_FILE)${RESET}`,
    );
  } else if (summary.sheets?.error) {
    console.log(`  Google Sheets: ${RED}${summary.sheets.error}${RESET}`);
  } else if (summary.sheets) {
    console.log(
      `  Google Sheets: ${GREEN}appended ${summary.sheets.appended} row(s)${RESET}`,
    );
  }

  console.log("");
}

export function sendDesktopNotification(summary: RunSummary): void {
  if (!config.notify) return;

  const title =
    summary.newJobs.length > 0
      ? `Job fetcher: ${summary.newJobs.length} new job(s)`
      : "Job fetcher: no new jobs";

  const bodyParts = [
    `Fetched ${summary.fetchedTotal}`,
    `new ${summary.newJobs.length}`,
  ];
  if (summary.skippedWithinRun) {
    bodyParts.push(`within-run ${summary.skippedWithinRun}`);
  }
  if (summary.skippedByTitle) {
    bodyParts.push(`title-filter ${summary.skippedByTitle}`);
  }
  if (summary.skippedByCv) {
    bodyParts.push(`cv ${summary.skippedByCv}`);
  }
  if (summary.skippedByPeerCv) {
    bodyParts.push(`peer-cv ${summary.skippedByPeerCv}`);
  }
  if (summary.skippedByPeerRole) {
    bodyParts.push(`peer-role ${summary.skippedByPeerRole}`);
  }
  bodyParts.push(`role-dupes ${summary.skippedDuplicates}`);
  if (summary.sheets && !summary.sheets.skipped && !summary.sheets.error) {
    bodyParts.push(`sheets +${summary.sheets.appended}`);
  }
  if (summary.bySource.hiringcafe?.error) bodyParts.push("HiringCafe error");
  if (summary.bySource.builtin.error) bodyParts.push("Built In error");
  if (summary.bySource.jobright?.error) bodyParts.push("JobRight error");
  if (summary.sheets?.error) bodyParts.push("Sheets error");
  const body = bodyParts.join(" · ");

  try {
    const result = spawnSync("notify-send", ["--app-name=job-fetcher", title, body], {
      stdio: "ignore",
    });
    if (result.error || (result.status !== 0 && result.status != null)) {
      process.stderr.write(`\u0007[notify] ${title} — ${body}\n`);
    }
  } catch {
    process.stderr.write(`\u0007[notify] ${title} — ${body}\n`);
  }
}

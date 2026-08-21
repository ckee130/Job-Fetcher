import { spawnSync } from "node:child_process";
import { config } from "./config.js";
import type { RunSummary } from "./types.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

function line(ch = "─", n = 56): string {
  return ch.repeat(n);
}

export function printRunSummary(summary: RunSummary): void {
  const hasErrors =
    Boolean(summary.bySource.hiringcafe.error) || Boolean(summary.bySource.builtin.error);
  const tone = hasErrors ? YELLOW : summary.newJobs.length > 0 ? GREEN : CYAN;

  console.log("");
  console.log(tone + BOLD + line("═") + RESET);
  console.log(tone + BOLD + "  Job fetch complete" + RESET);
  console.log(tone + BOLD + line("═") + RESET);
  console.log(`  Started:   ${summary.startedAt}`);
  console.log(`  Finished:  ${summary.finishedAt}`);
  console.log(`  Fetched:   ${summary.fetchedTotal} total listings`);
  console.log(
    `  New:       ${BOLD}${summary.newJobs.length}${RESET}  (duplicates skipped: ${summary.skippedDuplicates})`,
  );
  console.log(`  Output:    ${summary.outputPath}`);
  console.log(line());

  for (const source of ["hiringcafe", "builtin"] as const) {
    const s = summary.bySource[source];
    const status = s.error ? `${RED}ERROR${RESET}` : `${GREEN}OK${RESET}`;
    console.log(
      `  ${source.padEnd(12)} ${status}  fetched=${s.fetched}  new=${s.newCount}  pages=${s.pagesFetched}`,
    );
    if (s.error) console.log(`               ${RED}${s.error}${RESET}`);
  }

  console.log(line());

  if (summary.newJobs.length === 0) {
    console.log(
      `${CYAN}  No new jobs this run. Re-running is safe — seen links are stored locally.${RESET}`,
    );
  } else {
    console.log(`${GREEN}${BOLD}  New jobs:${RESET}`);
    for (const job of summary.newJobs.slice(0, 25)) {
      console.log(`  • [${job.source}] ${job.company} — ${job.title}`);
      console.log(`      ${job.jobLink}`);
    }
    if (summary.newJobs.length > 25) {
      console.log(`  … and ${summary.newJobs.length - 25} more (see output file)`);
    }
  }

  console.log(tone + BOLD + line("═") + RESET);
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
    `skipped ${summary.skippedDuplicates}`,
  ];
  if (summary.bySource.hiringcafe.error) bodyParts.push("HiringCafe error");
  if (summary.bySource.builtin.error) bodyParts.push("Built In error");
  const body = bodyParts.join(" · ");

  try {
    const result = spawnSync("notify-send", ["--app-name=job-fetcher", title, body], {
      stdio: "ignore",
    });
    if (result.error || (result.status !== 0 && result.status != null)) {
      // Fall back to bell + stderr note; keep CLI usable without a desktop session.
      process.stderr.write(`\u0007[notify] ${title} — ${body}\n`);
    }
  } catch {
    process.stderr.write(`\u0007[notify] ${title} — ${body}\n`);
  }
}

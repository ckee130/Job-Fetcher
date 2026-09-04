import fs from "node:fs";
import path from "node:path";

import { printRunSummary, sendDesktopNotification } from "./alerts.js";
import { config } from "./config.js";
import { dedupeWithinRun } from "./dedupe.js";
import { filterJobsByTitle } from "./filters.js";
import { progress, progressPhase } from "./progress.js";
import { appendRowsToSheet, filterJobsForUpload } from "./sheets.js";
import { enrichBuiltinApplyUrls, fetchBuiltinJobs } from "./sources/builtin.js";
import { resolveProfileName, setActiveProfile, getActiveProxyUrl } from "./profiles.js";
import { proxyHostForLog } from "./proxy.js";
import type { JobRecord, RunSummary } from "./types.js";

function writeOutput(newJobs: JobRecord[], allFetched: JobRecord[]): string {
  fs.mkdirSync(config.outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const payload = {
    generatedAt: new Date().toISOString(),
    newCount: newJobs.length,
    fetchedCount: allFetched.length,
    newJobs,
  };
  const stampedPath = path.join(config.outputDir, `new-jobs-${stamp}.json`);
  const latestPath = path.join(config.outputDir, "latest-new-jobs.json");
  const allPath = path.join(config.outputDir, "latest-all-fetched.json");
  fs.writeFileSync(stampedPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  fs.writeFileSync(
    allPath,
    JSON.stringify({ generatedAt: payload.generatedAt, jobs: allFetched }, null, 2) + "\n",
    "utf8",
  );
  return stampedPath;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const profile = setActiveProfile(resolveProfileName(argv));
  const startedAt = new Date().toISOString();

  console.log(`Job fetcher — profile: ${profile.name} · source: builtin`);
  const proxy = getActiveProxyUrl() || config.proxyUrl;
  console.log(`  proxy:   ${proxy ? proxyHostForLog(proxy) : "no"}`);
  if (config.maxPages > 0) console.log(`  maxPages: ${config.maxPages}`);

  const bySource: RunSummary["bySource"] = {
    builtin: { fetched: 0, newCount: 0, pagesFetched: 0 },
  };

  progressPhase("Fetching Built In (listings only)");
  const result = await fetchBuiltinJobs();
  bySource.builtin = {
    fetched: result.jobs.length,
    newCount: 0,
    pagesFetched: result.pagesFetched,
    error: result.error,
  };
  if (result.error) progress(`Built In failed: ${result.error}`);
  else progress(`Built In done — ${result.jobs.length} jobs, ${result.pagesFetched} pages`);

  progressPhase("Filtering");
  const { kept: withinRunJobs, skipped: skippedWithinRun } = dedupeWithinRun(result.jobs);
  if (skippedWithinRun > 0) {
    progress(`within-run dedupe: skipped ${skippedWithinRun} duplicate(s)`);
  }

  const { kept: titleFilteredJobs, skipped: skippedByTitle } = filterJobsByTitle(withinRunJobs);
  progress(`title filter: kept ${titleFilteredJobs.length}, skipped ${skippedByTitle}`);

  progressPhase("Upload prep (CV + sheet)");
  const uploadFilter = await filterJobsForUpload(titleFilteredJobs);
  const toUpload = uploadFilter.toUpload;

  if (toUpload.length > 0) {
    progressPhase("Resolving apply URLs");
    progress(`fetching employer URLs for ${toUpload.length} Built In job(s)…`);
    await enrichBuiltinApplyUrls(toUpload);
  }

  progressPhase("Google Sheets upload");
  const appended =
    toUpload.length > 0 && !uploadFilter.error
      ? await appendRowsToSheet(toUpload)
      : { appended: 0, uploadedJobs: [] as JobRecord[], error: uploadFilter.error };

  const newJobs = appended.uploadedJobs;
  bySource.builtin.newCount = newJobs.length;

  const outputPath = writeOutput(newJobs, titleFilteredJobs);
  const finishedAt = new Date().toISOString();

  const summary: RunSummary = {
    startedAt,
    finishedAt,
    fetchedTotal: titleFilteredJobs.length,
    newJobs,
    skippedDuplicates: uploadFilter.skippedDuplicates,
    skippedByCv: uploadFilter.skippedByCv,
    skippedByTitle,
    skippedWithinRun,
    bySource,
    outputPath,
    sheets: {
      appended: appended.appended,
      skippedDuplicates: uploadFilter.skippedDuplicates,
      skippedByCv: uploadFilter.skippedByCv,
      uploadedJobs: newJobs,
      skipped: uploadFilter.skipped,
      spreadsheetId: uploadFilter.spreadsheetId,
      error: appended.error ?? uploadFilter.error,
    },
  };

  printRunSummary(summary);
  sendDesktopNotification(summary);

  const failed = bySource.builtin.error || appended.error || uploadFilter.error;
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

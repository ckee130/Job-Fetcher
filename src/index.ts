import fs from "node:fs";
import path from "node:path";

import { printRunSummary, sendDesktopNotification } from "./alerts.js";
import { config } from "./config.js";
import { dedupeWithinRun } from "./dedupe.js";
import { filterJobsByTitle } from "./filters.js";
import { progress, progressPhase } from "./progress.js";
import { appendRowsToSheet, filterJobsForUpload } from "./sheets.js";
import { enrichBuiltinApplyUrls, fetchBuiltinJobs } from "./sources/builtin.js";
import { fetchJobrightJobs } from "./sources/jobright.js";
import { resolveProfileName, setActiveProfile, getActiveProxyUrl } from "./profiles.js";
import { proxyHostForLog } from "./proxy.js";
import type { JobRecord, JobSource, RunSummary } from "./types.js";

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

function emptySourceStats(): RunSummary["bySource"][JobSource] {
  return { fetched: 0, newCount: 0, pagesFetched: 0 };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const profile = setActiveProfile(resolveProfileName(argv));
  const startedAt = new Date().toISOString();

  console.log(`Job fetcher — profile: ${profile.name} · sources: builtin + jobright`);
  const proxy = getActiveProxyUrl() || config.proxyUrl;
  console.log(`  proxy:   ${proxy ? proxyHostForLog(proxy) : "no"}`);
  if (config.maxPages > 0) console.log(`  maxPages: ${config.maxPages}`);

  const bySource: RunSummary["bySource"] = {
    builtin: emptySourceStats(),
    jobright: emptySourceStats(),
  };

  progressPhase("Fetching Built In (listings only)");
  const builtinResult = await fetchBuiltinJobs();
  bySource.builtin = {
    fetched: builtinResult.jobs.length,
    newCount: 0,
    pagesFetched: builtinResult.pagesFetched,
    error: builtinResult.error,
  };
  if (builtinResult.error) progress(`Built In failed: ${builtinResult.error}`);
  else {
    progress(
      `Built In done — ${builtinResult.jobs.length} jobs, ${builtinResult.pagesFetched} pages`,
    );
  }

  progressPhase("Fetching JobRight (recommendations)");
  const jobrightResult = await fetchJobrightJobs();
  bySource.jobright = {
    fetched: jobrightResult.jobs.length,
    newCount: 0,
    pagesFetched: jobrightResult.pagesFetched,
    error: jobrightResult.error,
  };
  if (jobrightResult.error) progress(`JobRight failed: ${jobrightResult.error}`);
  else {
    progress(
      `JobRight done — ${jobrightResult.jobs.length} jobs, ${jobrightResult.pagesFetched} pages`,
    );
  }

  const allFetched = [...builtinResult.jobs, ...jobrightResult.jobs];

  progressPhase("Filtering");
  const { kept: withinRunJobs, skipped: skippedWithinRun } = dedupeWithinRun(allFetched);
  if (skippedWithinRun > 0) {
    progress(`within-run dedupe: skipped ${skippedWithinRun} duplicate(s)`);
  }

  const { kept: titleFilteredJobs, skipped: skippedByTitle } = filterJobsByTitle(withinRunJobs);
  progress(`title filter: kept ${titleFilteredJobs.length}, skipped ${skippedByTitle}`);

  progressPhase("Upload prep (CV + sheet)");
  const uploadFilter = await filterJobsForUpload(titleFilteredJobs);
  const toUpload = uploadFilter.toUpload;

  const builtinToEnrich = toUpload.filter((j) => j.source === "builtin");
  if (builtinToEnrich.length > 0) {
    progressPhase("Resolving apply URLs");
    progress(`fetching employer URLs for ${builtinToEnrich.length} Built In job(s)…`);
    await enrichBuiltinApplyUrls(builtinToEnrich);
  }

  progressPhase("Google Sheets upload");
  const appended =
    toUpload.length > 0 && !uploadFilter.error
      ? await appendRowsToSheet(toUpload)
      : { appended: 0, uploadedJobs: [] as JobRecord[], error: uploadFilter.error };

  const newJobs = appended.uploadedJobs;
  for (const job of newJobs) {
    bySource[job.source].newCount += 1;
  }

  const outputPath = writeOutput(newJobs, titleFilteredJobs);
  const finishedAt = new Date().toISOString();

  const summary: RunSummary = {
    startedAt,
    finishedAt,
    fetchedTotal: titleFilteredJobs.length,
    newJobs,
    skippedDuplicates: uploadFilter.skippedDuplicates,
    skippedByCv: uploadFilter.skippedByCv,
    skippedByPeerCv: uploadFilter.skippedByPeerCv,
    skippedByTitle,
    skippedWithinRun,
    bySource,
    outputPath,
    sheets: {
      appended: appended.appended,
      skippedDuplicates: uploadFilter.skippedDuplicates,
      skippedByCv: uploadFilter.skippedByCv,
      skippedByPeerCv: uploadFilter.skippedByPeerCv,
      uploadedJobs: newJobs,
      skipped: uploadFilter.skipped,
      spreadsheetId: uploadFilter.spreadsheetId,
      error: appended.error ?? uploadFilter.error,
    },
  };

  printRunSummary(summary);
  sendDesktopNotification(summary);

  const failed =
    bySource.builtin.error ||
    bySource.jobright.error ||
    appended.error ||
    uploadFilter.error;
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

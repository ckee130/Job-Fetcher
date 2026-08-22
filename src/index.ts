import fs from "node:fs";
import path from "node:path";

import { printRunSummary, sendDesktopNotification } from "./alerts.js";
import { config } from "./config.js";
import { dedupeCrossPlatform } from "./dedupe.js";
import { filterJobsByTitle } from "./filters.js";
import { progress, progressPhase } from "./progress.js";
import { appendRowsToSheet, filterJobsForUpload } from "./sheets.js";
import { enrichBuiltinApplyUrls, fetchBuiltinJobs } from "./sources/builtin.js";
import { fetchHiringCafeJobs } from "./sources/hiringcafe.js";
import type { JobRecord, JobSource, RunSummary } from "./types.js";

function parseSources(argv: string[]): JobSource[] {
  const flag = argv.find((a) => a.startsWith("--source="));
  if (!flag) return ["hiringcafe", "builtin"];
  const value = flag.slice("--source=".length).trim().toLowerCase();
  if (value === "hiringcafe" || value === "builtin") return [value];
  if (value === "all") return ["hiringcafe", "builtin"];
  throw new Error(`Unknown --source=${value}. Use hiringcafe, builtin, or all.`);
}

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
  const sources = parseSources(process.argv.slice(2));
  const startedAt = new Date().toISOString();

  console.log(`Job fetcher — sources: ${sources.join(", ")}`);
  if (config.maxPages > 0) console.log(`  maxPages: ${config.maxPages}`);

  const bySource: RunSummary["bySource"] = {
    hiringcafe: { fetched: 0, newCount: 0, pagesFetched: 0 },
    builtin: { fetched: 0, newCount: 0, pagesFetched: 0 },
  };

  const allFetched: JobRecord[] = [];

  if (sources.includes("hiringcafe")) {
    progressPhase("Fetching Hiring Cafe");
    const result = await fetchHiringCafeJobs();
    bySource.hiringcafe = {
      fetched: result.jobs.length,
      newCount: 0,
      pagesFetched: result.pagesFetched,
      error: result.error,
    };
    allFetched.push(...result.jobs);
    if (result.error) progress(`Hiring Cafe failed: ${result.error}`);
    else progress(`Hiring Cafe done — ${result.jobs.length} jobs, ${result.pagesFetched} pages`);
  }

  if (sources.includes("builtin")) {
    progressPhase("Fetching Built In (listings only)");
    const result = await fetchBuiltinJobs();
    bySource.builtin = {
      fetched: result.jobs.length,
      newCount: 0,
      pagesFetched: result.pagesFetched,
      error: result.error,
    };
    allFetched.push(...result.jobs);
    if (result.error) progress(`Built In failed: ${result.error}`);
    else progress(`Built In done — ${result.jobs.length} jobs, ${result.pagesFetched} pages`);
  }

  progressPhase("Filtering");
  const { kept: crossPlatformJobs, skipped: skippedCrossPlatform } =
    dedupeCrossPlatform(allFetched);
  if (skippedCrossPlatform > 0) {
    progress(`cross-platform dedupe: skipped ${skippedCrossPlatform} duplicate(s)`);
  }

  const { kept: titleFilteredJobs, skipped: skippedByTitle } =
    filterJobsByTitle(crossPlatformJobs);
  progress(
    `title filter: kept ${titleFilteredJobs.length}, skipped ${skippedByTitle}`,
  );

  progressPhase("Upload prep (CV + sheet)");
  const uploadFilter = await filterJobsForUpload(titleFilteredJobs);
  const toUpload = uploadFilter.toUpload;

  if (toUpload.length > 0) {
    progressPhase("Resolving apply URLs");
    const builtinToEnrich = toUpload.filter((j) => j.source === "builtin");
    if (builtinToEnrich.length > 0) {
      progress(`fetching employer URLs for ${builtinToEnrich.length} Built In job(s)…`);
      await enrichBuiltinApplyUrls(builtinToEnrich);
    }
  }

  progressPhase("Google Sheets upload");
  const appended =
    toUpload.length > 0 && !uploadFilter.error
      ? await appendRowsToSheet(toUpload)
      : { appended: 0, uploadedJobs: [] as JobRecord[], error: uploadFilter.error };

  const newJobs = appended.uploadedJobs;
  bySource.hiringcafe.newCount = newJobs.filter((j) => j.source === "hiringcafe").length;
  bySource.builtin.newCount = newJobs.filter((j) => j.source === "builtin").length;

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
    skippedCrossPlatform,
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

  const failed =
    (sources.includes("hiringcafe") && bySource.hiringcafe.error) ||
    (sources.includes("builtin") && bySource.builtin.error) ||
    appended.error ||
    uploadFilter.error;
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

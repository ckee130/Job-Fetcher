import fs from "node:fs";
import path from "node:path";

import { printRunSummary, sendDesktopNotification } from "./alerts.js";
import { config } from "./config.js";
import { dedupeWithinRun } from "./dedupe.js";
import { filterJobsByTitle } from "./filters.js";
import { progress, progressPhase } from "./progress.js";
import { appendRowsToSheet, filterJobsForUpload } from "./sheets.js";
import {
  closeBuiltinBrowser,
  enrichBuiltinApplyUrls,
  fetchBuiltinJobs,
  isBuiltinListingLink,
} from "./sources/builtin.js";
import { fetchHiringCafeJobs } from "./sources/hiringcafe.js";
import { fetchJobrightJobs } from "./sources/jobright.js";
import { resolveProfileName, setActiveProfile } from "./profiles.js";
import { proxyHostForLog } from "./proxy.js";
import type { FetchResult, JobRecord, JobSource, RunSummary } from "./types.js";

/**
 * Source priority (fetch + within-run dedupe order):
 * 1. Hiring Cafe  2. Built In  3. JobRight
 * Earlier sources win when the same company/URL appears.
 *
 * Limit with `--source=hc|bi|jr` (alias `--src=`).
 * Omit → all three. Example: `npm run fetch:clinton -- --src=bi`
 */
type EnabledSources = {
  hiringcafe: boolean;
  builtin: boolean;
  jobright: boolean;
};

const SOURCE_ALIASES: Record<string, JobSource> = {
  hc: "hiringcafe",
  hiringcafe: "hiringcafe",
  "hiring-cafe": "hiringcafe",
  bi: "builtin",
  builtin: "builtin",
  "built-in": "builtin",
  jr: "jobright",
  jobright: "jobright",
};

function resolveEnabledSources(argv: string[]): EnabledSources {
  const flags = argv
    .map((a) => {
      if (a.startsWith("--source=")) return a.slice("--source=".length);
      if (a.startsWith("--src=")) return a.slice("--src=".length);
      return "";
    })
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  if (flags.length === 0) {
    return { hiringcafe: true, builtin: true, jobright: true };
  }

  const enabled: EnabledSources = {
    hiringcafe: false,
    builtin: false,
    jobright: false,
  };
  const unknown: string[] = [];
  for (const raw of flags) {
    const key = SOURCE_ALIASES[raw];
    if (!key) {
      unknown.push(raw);
      continue;
    }
    enabled[key] = true;
  }
  if (unknown.length > 0) {
    throw new Error(
      `Unknown --src/--source=${unknown.join(", ")}. Use hc|bi|jr (or hiringcafe|builtin|jobright).`,
    );
  }
  if (!enabled.hiringcafe && !enabled.builtin && !enabled.jobright) {
    throw new Error("No sources enabled. Pass --src=hc|bi|jr or omit for all.");
  }
  return enabled;
}

function skippedSource(source: JobSource): FetchResult {
  return { source, jobs: [], pagesFetched: 0 };
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

function emptySourceStats(): RunSummary["bySource"][JobSource] {
  return { fetched: 0, newCount: 0, pagesFetched: 0 };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const profile = setActiveProfile(resolveProfileName(argv));
  const sources = resolveEnabledSources(argv);
  const startedAt = new Date().toISOString();

  const enabled = [
    sources.hiringcafe && "hiringcafe",
    sources.builtin && "builtin",
    sources.jobright && "jobright",
  ].filter(Boolean);
  console.log(
    `Job fetcher — profile: ${profile.name} · sources: ${enabled.join(" + ") || "(none)"}`,
  );
  const proxy = config.proxyUrl;
  console.log(`  proxy:   ${proxy ? proxyHostForLog(proxy) : "no"}`);
  if (config.maxPages > 0) console.log(`  maxPages: ${config.maxPages}`);

  const bySource: RunSummary["bySource"] = {
    hiringcafe: emptySourceStats(),
    builtin: emptySourceStats(),
    jobright: emptySourceStats(),
  };

  // Hiring Cafe first so it wins within-run company/URL dedupe against other sources.
  let hiringCafeResult: FetchResult;
  if (sources.hiringcafe) {
    progressPhase("Fetching Hiring Cafe");
    hiringCafeResult = await fetchHiringCafeJobs();
    bySource.hiringcafe = {
      fetched: hiringCafeResult.jobs.length,
      newCount: 0,
      pagesFetched: hiringCafeResult.pagesFetched,
      error: hiringCafeResult.error,
    };
    if (hiringCafeResult.error) progress(`Hiring Cafe failed: ${hiringCafeResult.error}`);
    else {
      progress(
        `Hiring Cafe done — ${hiringCafeResult.jobs.length} jobs, ${hiringCafeResult.pagesFetched} pages`,
      );
    }
  } else {
    hiringCafeResult = skippedSource("hiringcafe");
    progress("Hiring Cafe skipped (--source)");
  }

  let builtinResult: FetchResult;
  if (sources.builtin) {
    progressPhase("Fetching Built In (listings only)");
    builtinResult = await fetchBuiltinJobs();
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
  } else {
    builtinResult = skippedSource("builtin");
    progress("Built In skipped (--source)");
  }

  let jobrightResult: FetchResult;
  if (sources.jobright) {
    progressPhase("Fetching JobRight (recommendations)");
    jobrightResult = await fetchJobrightJobs();
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
  } else {
    jobrightResult = skippedSource("jobright");
    progress("JobRight skipped (--source)");
  }

  const allFetched = [
    ...hiringCafeResult.jobs,
    ...builtinResult.jobs,
    ...jobrightResult.jobs,
  ];

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

  // Never upload Built In listing URLs — only employer apply links.
  const uploadReady = toUpload.filter((j) => !isBuiltinListingLink(j));
  const skippedBuiltinListing = toUpload.length - uploadReady.length;
  if (skippedBuiltinListing > 0) {
    progress(
      `skipped ${skippedBuiltinListing} Built In job(s) without employer apply URL (not uploaded)`,
    );
  }

  progressPhase("Google Sheets upload");
  const appended =
    uploadReady.length > 0 && !uploadFilter.error
      ? await appendRowsToSheet(uploadReady)
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
    skippedByPeerRole: uploadFilter.skippedByPeerRole,
    skippedByTitle,
    skippedWithinRun,
    bySource,
    outputPath,
    sheets: {
      appended: appended.appended,
      skippedDuplicates: uploadFilter.skippedDuplicates,
      skippedByCv: uploadFilter.skippedByCv,
      skippedByPeerCv: uploadFilter.skippedByPeerCv,
      skippedByPeerRole: uploadFilter.skippedByPeerRole,
      uploadedJobs: newJobs,
      skipped: uploadFilter.skipped,
      spreadsheetId: uploadFilter.spreadsheetId,
      error: appended.error ?? uploadFilter.error,
    },
  };

  printRunSummary(summary);
  sendDesktopNotification(summary);

  const failed =
    bySource.hiringcafe.error ||
    bySource.builtin.error ||
    bySource.jobright.error ||
    appended.error ||
    uploadFilter.error;
  if (failed) process.exitCode = 1;

  await closeBuiltinBrowser();
}

main().catch(async (err) => {
  console.error("Fatal:", err);
  await closeBuiltinBrowser();
  process.exit(1);
});

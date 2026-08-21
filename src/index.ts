import fs from "node:fs";
import path from "node:path";

import { printRunSummary, sendDesktopNotification } from "./alerts.js";
import { config } from "./config.js";
import { fetchBuiltinJobs } from "./sources/builtin.js";
import { fetchHiringCafeJobs } from "./sources/hiringcafe.js";
import { filterNewJobs } from "./store.js";
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

  console.log("Job fetcher starting…");
  console.log(`  sources: ${sources.join(", ")}`);
  console.log(`  proxy:   ${config.proxyUrl ? "yes" : "no"}`);
  console.log(`  maxPages:${config.maxPages === 0 ? "all" : config.maxPages}`);
  console.log(
    "  note:    re-runs are safe — only NEW job links are reported (see data/seen-jobs.json)",
  );

  const bySource: RunSummary["bySource"] = {
    hiringcafe: { fetched: 0, newCount: 0, pagesFetched: 0 },
    builtin: { fetched: 0, newCount: 0, pagesFetched: 0 },
  };

  const allFetched: JobRecord[] = [];

  if (sources.includes("hiringcafe")) {
    process.stdout.write("Fetching Hiring Cafe… ");
    const result = await fetchHiringCafeJobs();
    bySource.hiringcafe = {
      fetched: result.jobs.length,
      newCount: 0,
      pagesFetched: result.pagesFetched,
      error: result.error,
    };
    allFetched.push(...result.jobs);
    console.log(
      result.error
        ? `failed (${result.error})`
        : `ok (${result.jobs.length} jobs, ${result.pagesFetched} pages)`,
    );
  }

  if (sources.includes("builtin")) {
    process.stdout.write("Fetching Built In… ");
    const result = await fetchBuiltinJobs();
    bySource.builtin = {
      fetched: result.jobs.length,
      newCount: 0,
      pagesFetched: result.pagesFetched,
      error: result.error,
    };
    allFetched.push(...result.jobs);
    console.log(
      result.error
        ? `failed (${result.error})`
        : `ok (${result.jobs.length} jobs, ${result.pagesFetched} pages)`,
    );
  }

  // Dedupe across sources by job link before seen-store filter
  const uniqueByLink = new Map<string, JobRecord>();
  for (const job of allFetched) {
    if (!uniqueByLink.has(job.jobLink)) uniqueByLink.set(job.jobLink, job);
  }
  const uniqueJobs = [...uniqueByLink.values()];

  const { newJobs, skippedDuplicates } = filterNewJobs(uniqueJobs);
  bySource.hiringcafe.newCount = newJobs.filter((j) => j.source === "hiringcafe").length;
  bySource.builtin.newCount = newJobs.filter((j) => j.source === "builtin").length;

  const outputPath = writeOutput(newJobs, uniqueJobs);
  const finishedAt = new Date().toISOString();

  const summary: RunSummary = {
    startedAt,
    finishedAt,
    fetchedTotal: uniqueJobs.length,
    newJobs,
    skippedDuplicates,
    bySource,
    outputPath,
  };

  printRunSummary(summary);
  sendDesktopNotification(summary);

  const failed =
    (sources.includes("hiringcafe") && bySource.hiringcafe.error) ||
    (sources.includes("builtin") && bySource.builtin.error);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

import fs from "node:fs";

import { config } from "./config.js";
import { progress } from "./progress.js";
import type { JobRecord } from "./types.js";

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** `D:\remote\CV\{sheet}` — `{sheet}` is replaced with GOOGLE_SHEET_NAME. */
export function resolveCvDir(sheetName: string): string {
  const template = config.cvDir.trim();
  if (!template) return "";
  return template.replace(/\{sheet\}/gi, sheetName);
}

function listFilenames(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch (err) {
    const code = err instanceof Error && "code" in err ? String(err.code) : "";
    if (code === "ENOENT") return [];
    throw err;
  }
}

/** True if any filename in the CV dir contains the company name. */
export function companyHasCvFile(company: string, filenames: string[]): boolean {
  const needle = normalizeText(company);
  if (!needle || filenames.length === 0) return false;
  return filenames.some((name) => normalizeText(name).includes(needle));
}

/**
 * Skip jobs when a CV file for that company already exists.
 * Path: CV_DIR with `{sheet}` → GOOGLE_SHEET_NAME (e.g. D:\remote\CV\Jobs).
 */
export function filterJobsByCvDir(
  jobs: JobRecord[],
  sheetName: string,
): { kept: JobRecord[]; skipped: number; cvDir: string } {
  const cvDir = resolveCvDir(sheetName);
  if (!cvDir) return { kept: jobs, skipped: 0, cvDir: "" };

  const filenames = listFilenames(cvDir);
  progress(`CV dir: ${cvDir} (${filenames.length} file(s))`);

  const kept: JobRecord[] = [];
  let skipped = 0;

  for (const job of jobs) {
    if (companyHasCvFile(job.company, filenames)) {
      skipped += 1;
      continue;
    }
    kept.push(job);
  }

  return { kept, skipped, cvDir };
}

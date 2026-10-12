import fs from "node:fs";

import { config } from "./config.js";
import { getActiveProfile, PROFILES, type ProfileName } from "./profiles.js";
import { progress } from "./progress.js";
import type { JobRecord } from "./types.js";

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function companyNameMatchVariants(company: string): string[] {
  const normalized = normalizeText(company);
  if (!normalized) return [];
  const words = normalized.split(" ").filter(Boolean);
  if (words.length <= 1) return [normalized];
  return [words.join(" "), words.join("-")];
}

export function companyNameSubdirKey(company: string): string {
  return normalizeText(company);
}

/** True if any filename in the CV dir contains the company name (or hyphen/space variants). */
export function companyHasCvFile(company: string, filenames: string[]): boolean {
  const variants = companyNameMatchVariants(company);
  if (variants.length === 0 || filenames.length === 0) return false;
  return filenames.some((name) => {
    const haystack = normalizeText(name);
    return variants.some((variant) => haystack.includes(variant));
  });
}

export function companyHasCvSubdir(company: string, dirNames: string[]): boolean {
  const key = companyNameSubdirKey(company);
  if (!key || dirNames.length === 0) return false;
  return dirNames.some((name) => companyNameSubdirKey(name) === key);
}

/** Prefer profile.cvRootDir; fall back to CV_DIR template with `{sheet}`. */
export function resolveCvDir(sheetName: string): string {
  const key = sheetName.trim();
  const match = (Object.keys(PROFILES) as ProfileName[]).find(
    (p) => p.toLowerCase() === key.toLowerCase(),
  );
  if (match) {
    const root = (PROFILES[match].cvRootDir || "").trim();
    if (root) return root;
  }
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

function listSubdirNames(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (err) {
    const code = err instanceof Error && "code" in err ? String(err.code) : "";
    if (code === "ENOENT") return [];
    throw err;
  }
}

export function filterJobsByCvDir(
  jobs: JobRecord[],
): { kept: JobRecord[]; skipped: number; cvDir: string } {
  const profile = getActiveProfile();
  const cvDir = (profile.cvRootDir || "").trim() || resolveCvDir(profile.name);
  if (!cvDir) return { kept: jobs, skipped: 0, cvDir: "" };

  const matchMode = profile.cvMatchMode ?? "filename";
  const kept: JobRecord[] = [];
  let skipped = 0;

  if (matchMode === "subdir") {
    const dirNames = listSubdirNames(cvDir);
    progress(`CV dir (subdir mode): ${cvDir} (${dirNames.length} folder(s))`);
    for (const job of jobs) {
      if (companyHasCvSubdir(job.company, dirNames)) {
        skipped += 1;
        continue;
      }
      kept.push(job);
    }
  } else {
    const filenames = listFilenames(cvDir);
    progress(`CV dir (filename mode): ${cvDir} (${filenames.length} file(s))`);
    for (const job of jobs) {
      if (companyHasCvFile(job.company, filenames)) {
        skipped += 1;
        continue;
      }
      kept.push(job);
    }
  }

  return { kept, skipped, cvDir };
}

export function filterJobsRequiringPeerCv(
  jobs: JobRecord[],
  peerProfileNames: readonly string[],
): { kept: JobRecord[]; skipped: number; peerDirs: string[] } {
  if (peerProfileNames.length === 0) {
    return { kept: jobs, skipped: 0, peerDirs: [] };
  }

  const peerDirs = peerProfileNames
    .map((name) => resolveCvDir(name))
    .filter((dir) => Boolean(dir));
  if (peerDirs.length === 0) {
    return { kept: jobs, skipped: 0, peerDirs: [] };
  }

  const peerFilenames = peerDirs.map((dir) => {
    const filenames = listFilenames(dir);
    progress(`peer CV dir: ${dir} (${filenames.length} file(s))`);
    return filenames;
  });

  const kept: JobRecord[] = [];
  let skipped = 0;

  for (const job of jobs) {
    const found = peerFilenames.some((filenames) =>
      companyHasCvFile(job.company, filenames),
    );
    if (!found) {
      skipped += 1;
      continue;
    }
    kept.push(job);
  }

  return { kept, skipped, peerDirs };
}

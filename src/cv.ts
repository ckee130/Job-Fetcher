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

/** Resume packages in Clinton/Nathan/Blake folders. */
function isCvResumeFile(name: string): boolean {
  return /\.(docx\.zip|zip|docx|pdf|rar|7z)$/i.test(name);
}

/** All resume files in a CV dir (zip, docx, rar, …) — top-level only. */
function listCvResumeFilenames(dir: string): string[] {
  return listFilenames(dir).filter(isCvResumeFile);
}

function countCvResumeByExt(filenames: string[]): string {
  const counts = { zip: 0, docx: 0, rar: 0, pdf: 0, other: 0 };
  for (const name of filenames) {
    if (/\.docx\.zip$/i.test(name) || /\.zip$/i.test(name)) counts.zip += 1;
    else if (/\.docx$/i.test(name)) counts.docx += 1;
    else if (/\.rar$/i.test(name)) counts.rar += 1;
    else if (/\.pdf$/i.test(name)) counts.pdf += 1;
    else counts.other += 1;
  }
  const parts = [
    `${counts.zip} zip`,
    `${counts.docx} docx`,
    `${counts.rar} rar`,
    `${counts.pdf} pdf`,
  ];
  if (counts.other) parts.push(`${counts.other} other`);
  return parts.join(", ");
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

/** `{person}-{YYYY-MM-DD}-{company}-{role}.ext` → stem after date. */
function cvCompanyRoleStem(filename: string): string {
  const base = filename.replace(/\.(docx\.zip|zip|docx|pdf|rar|7z)$/i, "");
  const m = base.match(/^[a-z]+-\d{4}-\d{2}-\d{2}-(.+)$/i);
  return (m?.[1] || "").trim();
}

/** Normalize for CV slug compare: "Capital One" / "capital-one" → "capital-one". */
function normalizeCvSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function cvRolesMatch(roleFromFile: string, jobTitle: string): boolean {
  const a = normalizeCvSlug(roleFromFile);
  const b = normalizeCvSlug(jobTitle);
  if (!a || !b) return false;
  if (a === b) return true;
  // Filenames are often truncated ("…full-stack-applica").
  if (a.startsWith(b) || b.startsWith(a)) return true;
  return false;
}

/** True if a peer CV filename is for this company + role. */
export function peerCvHasSameCompanyRole(
  company: string,
  title: string,
  filenames: string[],
): boolean {
  const companySlugs = companyNameMatchVariants(company)
    .map(normalizeCvSlug)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (companySlugs.length === 0 || filenames.length === 0) return false;

  for (const filename of filenames) {
    const stem = normalizeCvSlug(cvCompanyRoleStem(filename));
    if (!stem) continue;
    for (const companySlug of companySlugs) {
      if (stem === companySlug) continue;
      if (!stem.startsWith(`${companySlug}-`)) continue;
      const rolePart = stem.slice(companySlug.length + 1);
      if (cvRolesMatch(rolePart, title)) return true;
    }
  }
  return false;
}

/**
 * Skip jobs whose company+role already appears in a peer CV filename
 * (`person-YYYY-MM-DD-company-role.ext`). Same company, different role → keep.
 */
export function filterJobsByPeerCvRoles(
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
    const filenames = listCvResumeFilenames(dir);
    progress(
      `peer CV dir (company+role): ${dir} — ${filenames.length} file(s) (${countCvResumeByExt(filenames)})`,
    );
    return filenames;
  });

  const kept: JobRecord[] = [];
  let skipped = 0;

  for (const job of jobs) {
    const hit = peerFilenames.some((filenames) =>
      peerCvHasSameCompanyRole(job.company, job.title, filenames),
    );
    if (hit) {
      skipped += 1;
      continue;
    }
    kept.push(job);
  }

  return { kept, skipped, peerDirs };
}

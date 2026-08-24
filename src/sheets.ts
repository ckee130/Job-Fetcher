import fs from "node:fs";
import path from "node:path";

import { google, type sheets_v4 } from "googleapis";

import { config } from "./config.js";
import { filterJobsByCvDir } from "./cv.js";
import { progress } from "./progress.js";
import { getActiveProfile } from "./profiles.js";
import type { JobRecord } from "./types.js";

const HEADER = ["Company", "Role", "Job Link", "Source", "Date"] as const;

export type SheetsAppendResult = {
  appended: number;
  skippedDuplicates: number;
  skippedByCv: number;
  uploadedJobs: JobRecord[];
  skipped: boolean;
  spreadsheetId?: string;
  error?: string;
};

export function normalizeCompany(name: string): string {
  return normalizeText(name);
}

export function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Local calendar date as YYYY-MM-DD (no time). */
export function todayDate(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function resolveCredentialsPath(): string | null {
  const raw = config.googleServiceAccountFile;
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.join(config.rootDir, raw);
}

export function isSheetsConfigured(): boolean {
  return Boolean(config.googleSpreadsheetId && config.googleServiceAccountFile);
}

async function getSheetsClient() {
  const keyFile = resolveCredentialsPath();
  if (!keyFile) throw new Error("GOOGLE_SERVICE_ACCOUNT_FILE is not set");
  if (!fs.existsSync(keyFile)) {
    throw new Error(`Service account file not found: ${keyFile}`);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function ensureSheetExists(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
): Promise<void> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  const titles = (meta.data.sheets ?? [])
    .map((s: sheets_v4.Schema$Sheet) => s.properties?.title)
    .filter((title: string | null | undefined): title is string => Boolean(title));
  if (titles.includes(sheetName)) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetName } } }],
    },
  });
}

async function ensureHeader(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
): Promise<void> {
  const range = `${sheetName}!A1:E1`;
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const firstRow = existing.data.values?.[0] ?? [];

  if (firstRow.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[...HEADER]] },
    });
    return;
  }

  // Older sheets may lack the Date column header.
  if (String(firstRow[4] ?? "").trim().toLowerCase() !== "date") {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!E1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [["Date"]] },
    });
  }
}

/** Company name already on the sheet (normalized). */
async function loadExistingCompanies(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
): Promise<Set<string>> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:A`,
  });
  const rows = res.data.values ?? [];
  const companies = new Set<string>();
  for (let i = 0; i < rows.length; i += 1) {
    const company = String(rows[i]?.[0] ?? "").trim();
    if (!company) continue;
    if (i === 0 && company.toLowerCase() === "company") continue;
    const key = normalizeCompany(company);
    if (key) companies.add(key);
  }
  return companies;
}

/**
 * Skip when the company already exists on the sheet or earlier in this run.
 * Only one row per company — different titles at the same company are ignored.
 */
export function filterJobsBySheetCompanies(
  jobs: JobRecord[],
  existingCompanies: Set<string>,
): { toUpload: JobRecord[]; skippedDuplicates: number } {
  const seen = new Set(existingCompanies);
  const toUpload: JobRecord[] = [];
  let skippedDuplicates = 0;

  for (const job of jobs) {
    const key = normalizeCompany(job.company);
    if (!key || seen.has(key)) {
      skippedDuplicates += 1;
      continue;
    }
    seen.add(key);
    toUpload.push(job);
  }

  return { toUpload, skippedDuplicates };
}

export type UploadFilterResult = {
  toUpload: JobRecord[];
  skippedDuplicates: number;
  skippedByCv: number;
  skipped: boolean;
  spreadsheetId?: string;
  error?: string;
};

/**
 * CV dir + sheet company check only (no apply URL needed).
 * Run this before fetching Built In detail pages.
 */
export async function filterJobsForUpload(jobs: JobRecord[]): Promise<UploadFilterResult> {
  if (!isSheetsConfigured()) {
    return { toUpload: [], skippedDuplicates: 0, skippedByCv: 0, skipped: true };
  }

  const spreadsheetId = config.googleSpreadsheetId;
  const sheetName = getActiveProfile().name;

  try {
    progress("connecting to Google Sheets…");
    const sheets = await getSheetsClient();
    await ensureSheetExists(sheets, spreadsheetId, sheetName);
    await ensureHeader(sheets, spreadsheetId, sheetName);

    progress("checking CV directory…");
    const { kept: afterCv, skipped: skippedByCv, cvDir } = filterJobsByCvDir(jobs, sheetName);
    if (cvDir && skippedByCv > 0) {
      progress(`skipped ${skippedByCv} job(s) — CV file exists for company`);
    }

    progress("loading existing companies…");
    const existingCompanies = await loadExistingCompanies(sheets, spreadsheetId, sheetName);
    progress(`sheet has ${existingCompanies.size} company row(s)`);

    const { toUpload, skippedDuplicates } = filterJobsBySheetCompanies(afterCv, existingCompanies);
    progress(
      `will upload ${toUpload.length} · skipped (company already on sheet): ${skippedDuplicates}`,
    );

    return { toUpload, skippedDuplicates, skippedByCv, skipped: false, spreadsheetId };
  } catch (err) {
    return {
      toUpload: [],
      skippedDuplicates: 0,
      skippedByCv: 0,
      skipped: false,
      spreadsheetId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Append pre-filtered rows. Sheet must already exist with header. */
export async function appendRowsToSheet(
  jobs: JobRecord[],
): Promise<{ appended: number; uploadedJobs: JobRecord[]; error?: string }> {
  if (jobs.length === 0) return { appended: 0, uploadedJobs: [] };
  if (!isSheetsConfigured()) {
    return { appended: 0, uploadedJobs: [], error: "Google Sheets not configured" };
  }

  const spreadsheetId = config.googleSpreadsheetId;
  const sheetName = getActiveProfile().name;

  try {
    const sheets = await getSheetsClient();
    progress(`appending ${jobs.length} row(s)…`);
    const date = todayDate();
    const values = jobs.map((job) => [
      job.company,
      job.title,
      job.jobLink,
      job.source,
      `'${date}`, // leading ' keeps YYYY-MM-DD as text (avoids serial like 46256)
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:E`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });

    progress(`appended ${jobs.length} row(s) with date ${date}`);
    return { appended: jobs.length, uploadedJobs: jobs };
  } catch (err) {
    return {
      appended: 0,
      uploadedJobs: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Filter + append in one call (legacy). Prefer filterJobsForUpload → enrich URLs → appendRowsToSheet. */
export async function appendJobsToSheet(jobs: JobRecord[]): Promise<SheetsAppendResult> {
  const filtered = await filterJobsForUpload(jobs);
  if (filtered.skipped) {
    return {
      appended: 0,
      skippedDuplicates: 0,
      skippedByCv: 0,
      uploadedJobs: [],
      skipped: true,
    };
  }
  if (filtered.error) {
    return {
      appended: 0,
      skippedDuplicates: filtered.skippedDuplicates,
      skippedByCv: filtered.skippedByCv,
      uploadedJobs: [],
      skipped: false,
      spreadsheetId: filtered.spreadsheetId,
      error: filtered.error,
    };
  }
  const appended = await appendRowsToSheet(filtered.toUpload);
  return {
    appended: appended.appended,
    skippedDuplicates: filtered.skippedDuplicates,
    skippedByCv: filtered.skippedByCv,
    uploadedJobs: appended.uploadedJobs,
    skipped: false,
    spreadsheetId: filtered.spreadsheetId,
    error: appended.error,
  };
}

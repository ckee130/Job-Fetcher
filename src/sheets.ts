import fs from "node:fs";
import path from "node:path";

import { google, type sheets_v4 } from "googleapis";

import { config } from "./config.js";
import { filterJobsByCvDir } from "./cv.js";
import { progress } from "./progress.js";
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

/** Dedupe key: company + role title. */
export function companyRoleKey(company: string, role: string): string {
  return `${normalizeText(company)}\0${normalizeText(role)}`;
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

/** Company+role pairs already on the sheet (normalized). */
async function loadExistingCompanyRoles(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
): Promise<Set<string>> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:B`,
  });
  const rows = res.data.values ?? [];
  const keys = new Set<string>();
  for (let i = 0; i < rows.length; i += 1) {
    const company = String(rows[i]?.[0] ?? "").trim();
    const role = String(rows[i]?.[1] ?? "").trim();
    if (!company || !role) continue;
    if (i === 0 && company.toLowerCase() === "company") continue;
    keys.add(companyRoleKey(company, role));
  }
  return keys;
}

/**
 * Skip only when the same company + same role title already exists
 * (on the sheet or earlier in this run). Different roles at the same
 * company are all uploaded.
 */
export function filterJobsBySheetCompanyRoles(
  jobs: JobRecord[],
  existingKeys: Set<string>,
): { toUpload: JobRecord[]; skippedDuplicates: number } {
  const seen = new Set(existingKeys);
  const toUpload: JobRecord[] = [];
  let skippedDuplicates = 0;

  for (const job of jobs) {
    const key = companyRoleKey(job.company, job.title);
    if (!normalizeText(job.company) || !normalizeText(job.title) || seen.has(key)) {
      skippedDuplicates += 1;
      continue;
    }
    seen.add(key);
    toUpload.push(job);
  }

  return { toUpload, skippedDuplicates };
}

/**
 * Dedupe by company+role against Google Sheets, then append.
 * Columns: Company | Role | Job Link | Source | Date (YYYY-MM-DD).
 */
export async function appendJobsToSheet(jobs: JobRecord[]): Promise<SheetsAppendResult> {
  if (!isSheetsConfigured()) {
    return { appended: 0, skippedDuplicates: 0, skippedByCv: 0, uploadedJobs: [], skipped: true };
  }

  const spreadsheetId = config.googleSpreadsheetId;
  const sheetName = config.googleSheetName;

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

    progress("loading existing company + role rows…");
    const existingKeys = await loadExistingCompanyRoles(sheets, spreadsheetId, sheetName);
    progress(`sheet has ${existingKeys.size} company/role row(s)`);

    const { toUpload, skippedDuplicates } = filterJobsBySheetCompanyRoles(afterCv, existingKeys);
    progress(
      `to upload: ${toUpload.length} · skipped (same company + role on sheet): ${skippedDuplicates}`,
    );

    if (toUpload.length === 0) {
      return {
        appended: 0,
        skippedDuplicates,
        skippedByCv,
        uploadedJobs: [],
        skipped: false,
        spreadsheetId,
      };
    }

    progress(`appending ${toUpload.length} row(s)…`);
    const date = todayDate();
    const values = toUpload.map((job) => [
      job.company,
      job.title,
      job.jobLink,
      job.source,
      date,
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:E`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });

    progress(`appended ${toUpload.length} row(s) with date ${date}`);

    return {
      appended: toUpload.length,
      skippedDuplicates,
      skippedByCv,
      uploadedJobs: toUpload,
      skipped: false,
      spreadsheetId,
    };
  } catch (err) {
    return {
      appended: 0,
      skippedDuplicates: 0,
      skippedByCv: 0,
      uploadedJobs: [],
      skipped: false,
      spreadsheetId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

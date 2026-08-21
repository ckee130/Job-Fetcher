import fs from "node:fs";
import path from "node:path";

import { google, type sheets_v4 } from "googleapis";

import { config } from "./config.js";
import { progress } from "./progress.js";
import type { JobRecord } from "./types.js";

const HEADER = ["Company", "Role", "Job Link", "Source", "Date"] as const;

export type SheetsAppendResult = {
  appended: number;
  skippedDuplicates: number;
  uploadedJobs: JobRecord[];
  skipped: boolean;
  spreadsheetId?: string;
  error?: string;
};

export function normalizeCompany(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
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

/** Companies already on the sheet (normalized). */
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
    const cell = String(rows[i]?.[0] ?? "").trim();
    if (!cell) continue;
    if (i === 0 && cell.toLowerCase() === "company") continue;
    companies.add(normalizeCompany(cell));
  }
  return companies;
}

/**
 * Skip jobs whose company is already on the sheet.
 * Multiple jobs for a *new* company in the same run are all kept.
 */
export function filterJobsBySheetCompanies(
  jobs: JobRecord[],
  existingCompanies: Set<string>,
): { toUpload: JobRecord[]; skippedDuplicates: number } {
  const toUpload: JobRecord[] = [];
  let skippedDuplicates = 0;

  for (const job of jobs) {
    const key = normalizeCompany(job.company);
    if (!key || existingCompanies.has(key)) {
      skippedDuplicates += 1;
      continue;
    }
    toUpload.push(job);
  }

  return { toUpload, skippedDuplicates };
}

/**
 * Dedupe by company against Google Sheets, then append.
 * Columns: Company | Role | Job Link | Source | Date (YYYY-MM-DD).
 */
export async function appendJobsToSheet(jobs: JobRecord[]): Promise<SheetsAppendResult> {
  if (!isSheetsConfigured()) {
    return { appended: 0, skippedDuplicates: 0, uploadedJobs: [], skipped: true };
  }

  const spreadsheetId = config.googleSpreadsheetId;
  const sheetName = config.googleSheetName;

  try {
    progress("connecting to Google Sheets…");
    const sheets = await getSheetsClient();
    await ensureSheetExists(sheets, spreadsheetId, sheetName);
    await ensureHeader(sheets, spreadsheetId, sheetName);

    progress("loading existing companies…");
    const existingCompanies = await loadExistingCompanies(sheets, spreadsheetId, sheetName);
    progress(`sheet has ${existingCompanies.size} compan${existingCompanies.size === 1 ? "y" : "ies"}`);

    const { toUpload, skippedDuplicates } = filterJobsBySheetCompanies(jobs, existingCompanies);
    progress(
      `to upload: ${toUpload.length} · skipped (company already on sheet): ${skippedDuplicates}`,
    );

    if (toUpload.length === 0) {
      return {
        appended: 0,
        skippedDuplicates,
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
      uploadedJobs: toUpload,
      skipped: false,
      spreadsheetId,
    };
  } catch (err) {
    return {
      appended: 0,
      skippedDuplicates: 0,
      uploadedJobs: [],
      skipped: false,
      spreadsheetId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

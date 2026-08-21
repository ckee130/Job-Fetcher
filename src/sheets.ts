import fs from "node:fs";
import path from "node:path";

import { google, type sheets_v4 } from "googleapis";

import { config } from "./config.js";
import type { JobRecord } from "./types.js";

const HEADER = ["Company", "Role", "Job Link", "Source"] as const;

export type SheetsAppendResult = {
  appended: number;
  skipped: boolean;
  spreadsheetId?: string;
  error?: string;
};

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
  const range = `${sheetName}!A1:D1`;
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const firstRow = existing.data.values?.[0];
  if (firstRow && firstRow.length > 0) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[...HEADER]] },
  });
}

/** Append new jobs to the configured Google Sheet. No-op if Sheets is not configured. */
export async function appendJobsToSheet(jobs: JobRecord[]): Promise<SheetsAppendResult> {
  if (!isSheetsConfigured()) {
    return { appended: 0, skipped: true };
  }

  const spreadsheetId = config.googleSpreadsheetId;
  const sheetName = config.googleSheetName;

  try {
    if (jobs.length === 0) {
      return { appended: 0, skipped: false, spreadsheetId };
    }

    const sheets = await getSheetsClient();
    await ensureSheetExists(sheets, spreadsheetId, sheetName);
    await ensureHeader(sheets, spreadsheetId, sheetName);

    const values = jobs.map((job) => [job.company, job.title, job.jobLink, job.source]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:D`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });

    return { appended: jobs.length, skipped: false, spreadsheetId };
  } catch (err) {
    return {
      appended: 0,
      skipped: false,
      spreadsheetId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

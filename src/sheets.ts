import fs from "node:fs";
import path from "node:path";

import { google, type sheets_v4 } from "googleapis";

import { config } from "./config.js";
import { filterJobsByCvDir, filterJobsByPeerCvRoles } from "./cv.js";
import { progress } from "./progress.js";
import { getActiveProfile } from "./profiles.js";
import type { JobRecord } from "./types.js";

const HEADER = ["Company", "Role", "Job Link", "Source", "Date", "Type"] as const;

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
  const range = `${sheetName}!A1:F1`;
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

  // Older sheets may lack the Type (employment) column.
  if (String(firstRow[5] ?? "").trim().toLowerCase() !== "type") {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!F1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [["Type"]] },
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

/** Job Link column, stable enough that the same URL matches across sheets. */
export function normalizeJobLink(url: string): string {
  const raw = url.trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    u.hash = "";
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    for (const param of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gh_src", "gh_jid"]) {
      u.searchParams.delete(param);
    }
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    const search = u.searchParams.toString();
    return `${u.protocol}//${u.hostname}${u.pathname}${search ? `?${search}` : ""}`;
  } catch {
    return raw;
  }
}

/** Job links already on a sheet. Skips the header row. */
async function loadExistingJobLinks(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
): Promise<Set<string>> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!C:C`,
  });
  const rows = res.data.values ?? [];
  const links = new Set<string>();
  for (let i = 0; i < rows.length; i += 1) {
    const link = String(rows[i]?.[0] ?? "").trim();
    if (!link) continue;
    if (i === 0 && link.toLowerCase() === "job link") continue;
    const key = normalizeJobLink(link);
    if (key) links.add(key);
  }
  return links;
}

/** Skip when the same job link is already on a peer sheet. */
export function filterJobsByPeerSheetLinks(
  jobs: JobRecord[],
  existingLinks: Set<string>,
): { toUpload: JobRecord[]; skipped: number } {
  const toUpload: JobRecord[] = [];
  let skipped = 0;

  for (const job of jobs) {
    const key = normalizeJobLink(job.jobLink);
    if (key && existingLinks.has(key)) {
      skipped += 1;
      continue;
    }
    toUpload.push(job);
  }

  return { toUpload, skipped };
}

async function listSheetTitles(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<Set<string>> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  const titles = (meta.data.sheets ?? [])
    .map((s: sheets_v4.Schema$Sheet) => s.properties?.title)
    .filter((title: string | null | undefined): title is string => Boolean(title));
  return new Set(titles);
}

export type UploadFilterResult = {
  toUpload: JobRecord[];
  skippedDuplicates: number;
  skippedByCv: number;
  skippedByPeerRole: number;
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
    return {
      toUpload: [],
      skippedDuplicates: 0,
      skippedByCv: 0,
      skippedByPeerRole: 0,
      skipped: true,
    };
  }

  const spreadsheetId = config.googleSpreadsheetId;
  const profile = getActiveProfile();
  const sheetName = profile.name;

  try {
    progress("connecting to Google Sheets…");
    const sheets = await getSheetsClient();
    await ensureSheetExists(sheets, spreadsheetId, sheetName);
    await ensureHeader(sheets, spreadsheetId, sheetName);

    progress("checking CV directory…");
    const cvFilter = filterJobsByCvDir(jobs);
    const afterCv = cvFilter.kept;
    const skippedByCv = cvFilter.skipped;
    if (cvFilter.cvDir && skippedByCv > 0) {
      const how =
        profile.cvMatchMode === "subdir" ? "company folder exists" : "CV file exists for company";
      progress(`skipped ${skippedByCv} job(s) — ${how}`);
    }

    let afterPeerRole = afterCv;
    let skippedByPeerRole = 0;
    const peerNames = profile.skipSameRoleOnPeerCvs ?? [];
    if (peerNames.length > 0) {
      progress(
        `checking peer CV files for same company+role (${peerNames.join(", ")})…`,
      );
      const peerFilter = filterJobsByPeerCvRoles(afterCv, peerNames);
      afterPeerRole = peerFilter.kept;
      skippedByPeerRole = peerFilter.skipped;
      if (skippedByPeerRole > 0) {
        progress(
          `skipped ${skippedByPeerRole} job(s) — same company+role already in ${peerNames.join(" or ")} CV folder`,
        );
      }
    }

    let toUpload: JobRecord[];
    let skippedDuplicates = 0;
    if (profile.skipSheetCompanyCheck) {
      progress("skipping sheet company check (local-only dedupe)");
      // Still one row per company within this run.
      ({ toUpload, skippedDuplicates } = filterJobsBySheetCompanies(afterPeerRole, new Set()));
      progress(
        `will upload ${toUpload.length} · skipped (duplicate company in run): ${skippedDuplicates}`,
      );
    } else {
      progress("loading existing companies…");
      const existingCompanies = await loadExistingCompanies(sheets, spreadsheetId, sheetName);
      progress(`sheet has ${existingCompanies.size} company row(s)`);
      ({ toUpload, skippedDuplicates } = filterJobsBySheetCompanies(
        afterPeerRole,
        existingCompanies,
      ));
      progress(
        `will upload ${toUpload.length} · skipped (company already on sheet): ${skippedDuplicates}`,
      );
    }

    return {
      toUpload,
      skippedDuplicates,
      skippedByCv,
      skippedByPeerRole,
      skipped: false,
      spreadsheetId,
    };
  } catch (err) {
    return {
      toUpload: [],
      skippedDuplicates: 0,
      skippedByCv: 0,
      skippedByPeerRole: 0,
      skipped: false,
      spreadsheetId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Append pre-filtered rows. Sheet must already exist with header. */
export async function appendRowsToSheet(
  jobs: JobRecord[],
): Promise<{ appended: number; uploadedJobs: JobRecord[]; skippedByPeerSheet: number; error?: string }> {
  if (jobs.length === 0) return { appended: 0, uploadedJobs: [], skippedByPeerSheet: 0 };
  if (!isSheetsConfigured()) {
    return { appended: 0, uploadedJobs: [], skippedByPeerSheet: 0, error: "Google Sheets not configured" };
  }

  const spreadsheetId = config.googleSpreadsheetId;
  const profile = getActiveProfile();
  const sheetName = profile.name;

  try {
    const sheets = await getSheetsClient();
    let rows = jobs;
    let skippedByPeerSheet = 0;
    const peerSheets = profile.peerSheetNames ?? [];
    if (peerSheets.length > 0) {
      progress(`checking ${peerSheets.join(" and ")} sheets for the same job link…`);
      const titles = await listSheetTitles(sheets, spreadsheetId);
      const peerLinks = new Set<string>();
      for (const name of peerSheets) {
        if (!titles.has(name)) {
          progress(`${name} sheet is missing — nothing to match`);
          continue;
        }
        const links = await loadExistingJobLinks(sheets, spreadsheetId, name);
        progress(`${name} sheet has ${links.size} job link(s)`);
        for (const link of links) peerLinks.add(link);
      }
      const peerLinkFilter = filterJobsByPeerSheetLinks(rows, peerLinks);
      rows = peerLinkFilter.toUpload;
      skippedByPeerSheet = peerLinkFilter.skipped;
      if (skippedByPeerSheet > 0) {
        progress(
          `skipped ${skippedByPeerSheet} job(s) — same job link already on ${peerSheets.join(" or ")} sheet`,
        );
      }
    }

    if (rows.length === 0) {
      return { appended: 0, uploadedJobs: [], skippedByPeerSheet };
    }

    progress(`appending ${rows.length} row(s)…`);
    const date = todayDate();
    const values = rows.map((job) => [
      job.company,
      job.title,
      job.jobLink,
      job.source,
      `'${date}`, // leading ' keeps YYYY-MM-DD as text (avoids serial like 46256)
      job.employmentType || "",
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:F`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });

    progress(`appended ${rows.length} row(s) with date ${date}`);
    return { appended: rows.length, uploadedJobs: rows, skippedByPeerSheet };
  } catch (err) {
    return {
      appended: 0,
      uploadedJobs: [],
      skippedByPeerSheet: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

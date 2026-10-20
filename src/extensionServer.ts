import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { config } from "./config.js";
import { dedupeWithinRun } from "./dedupe.js";
import { filterJobsByTitle } from "./filters.js";
import { progress, progressPhase } from "./progress.js";
import { listProfiles, setActiveProfile } from "./profiles.js";
import { appendRowsToSheet, filterJobsForUpload } from "./sheets.js";
import type { JobRecord, JobSource } from "./types.js";

const SOURCES = new Set<JobSource>(["hiringcafe", "builtin", "jobright", "dice", "indeed"]);
const MAX_BODY = 2_000_000;

function loadToken(): string {
  if (config.extensionToken) return config.extensionToken;
  const file = path.join(config.dataDir, "extension-token.txt");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch {
    // first run
  }
  const token = crypto.randomBytes(24).toString("hex");
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file, `${token}\n`, "utf8");
  return token;
}

function tokensMatch(got: string, expected: string): boolean {
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isBuiltinHost(url: string): boolean {
  try {
    return /(?:^|\.)builtin\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function asJob(raw: unknown): JobRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const company = typeof row.company === "string" ? row.company.trim() : "";
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const jobLink = typeof row.jobLink === "string" ? row.jobLink.trim() : "";
  const source = typeof row.source === "string" ? row.source.trim() : "";
  if (!company || !title || !jobLink || !SOURCES.has(source as JobSource)) return null;
  const listingUrl = typeof row.listingUrl === "string" ? row.listingUrl.trim() : "";
  const externalId = typeof row.externalId === "string" ? row.externalId.trim() : "";
  const employmentType = typeof row.employmentType === "string" ? row.employmentType.trim() : "";
  return {
    company,
    title,
    jobLink,
    source: source as JobSource,
    ...(listingUrl ? { listingUrl } : {}),
    ...(externalId ? { externalId } : {}),
    ...(employmentType ? { employmentType } : {}),
  };
}

async function prepare(profileName: string, jobs: JobRecord[]) {
  const profile = setActiveProfile(profileName);
  progressPhase(`Extension duplicate check (${profile.name})`);
  progress(`received ${jobs.length} job(s)`);

  const { kept: withinRunJobs, skipped: skippedWithinRun } = dedupeWithinRun(jobs);
  const { kept: titleFilteredJobs, skipped: skippedByTitle } = filterJobsByTitle(withinRunJobs);
  const uploadFilter = await filterJobsForUpload(titleFilteredJobs);
  progress(`duplicate check kept ${uploadFilter.toUpload.length} job(s) for apply links`);

  return {
    ok: !uploadFilter.error && !uploadFilter.skipped,
    profile: profile.name,
    received: jobs.length,
    jobs: uploadFilter.toUpload,
    skippedWithinRun,
    skippedByTitle,
    skippedByCv: uploadFilter.skippedByCv,
    skippedByPeerRole: uploadFilter.skippedByPeerRole,
    skippedDuplicates: uploadFilter.skippedDuplicates,
    error:
      uploadFilter.error ??
      (uploadFilter.skipped ? "Google Sheets is not configured" : undefined),
  };
}

async function upload(profileName: string, jobs: JobRecord[]) {
  const profile = setActiveProfile(profileName);
  progressPhase(`Extension upload (${profile.name})`);

  const uploadReady = jobs.filter((job) => !(job.source === "builtin" && isBuiltinHost(job.jobLink)));
  const skippedBuiltinListing = jobs.length - uploadReady.length;
  if (skippedBuiltinListing > 0) {
    progress(
      `skipped ${skippedBuiltinListing} Built In job(s) without employer apply URL (not uploaded)`,
    );
  }

  const appended =
    uploadReady.length > 0 ? await appendRowsToSheet(uploadReady) : { appended: 0, error: undefined };

  return {
    ok: !appended.error,
    profile: profile.name,
    skippedBuiltinListing,
    appended: appended.appended,
    error: appended.error,
  };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  });
  res.end(json);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const token = loadToken();
const port = config.extensionPort;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, profiles: listProfiles() });
    return;
  }

  if (req.method !== "POST" || (url.pathname !== "/prepare" && url.pathname !== "/upload")) {
    sendJson(res, 404, { ok: false, error: "Not found" });
    return;
  }

  const header = req.headers.authorization || "";
  const got = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!tokensMatch(got, token)) {
    sendJson(res, 401, { ok: false, error: "Bad token" });
    return;
  }

  try {
    const payload = JSON.parse(await readBody(req)) as { profile?: unknown; jobs?: unknown };
    const profile = typeof payload.profile === "string" ? payload.profile : "";
    const jobs = Array.isArray(payload.jobs)
      ? payload.jobs.map(asJob).filter((job): job is JobRecord => Boolean(job))
      : [];
    if (!profile) {
      sendJson(res, 400, { ok: false, error: "Missing profile" });
      return;
    }
    const result =
      url.pathname === "/prepare" ? await prepare(profile, jobs) : await upload(profile, jobs);
    sendJson(res, result.ok ? 200 : 500, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 400, { ok: false, error: message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Job fetcher extension server — http://127.0.0.1:${port}`);
  console.log(`  token: ${token}`);
  console.log("  Paste the token into the extension, then leave this window open.");
});

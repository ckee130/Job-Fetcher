import fs from "node:fs";
import path from "node:path";

import { config } from "../config.js";
import { normalizeEmploymentType } from "../employment.js";
import { shouldSkipJob } from "../filters.js";
import { httpGet, httpPostJson, sleep } from "../http.js";
import { getActiveProfile } from "../profiles.js";
import { progress } from "../progress.js";
import type { FetchResult, JobRecord } from "../types.js";

const API_BASE = "https://swan-api.jobright.ai";
const SITE_BASE = "https://jobright.ai";
const PAGE_SIZE = 20;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [15_000, 45_000, 90_000] as const;

class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionExpiredError";
  }
}

type JobrightApiJob = {
  jobResult?: {
    jobId?: string;
    jobTitle?: string;
    applyLink?: string;
    jobLocation?: string;
    employmentType?: string;
  };
  companyResult?: {
    companyName?: string;
  };
};

type RecommendResponse = {
  success?: boolean;
  message?: string;
  result?: { jobList?: JobrightApiJob[] };
};

type JobrightAuth = {
  email: string;
  password: string;
  sessionId: string;
  emailEnv: string;
  passwordEnv: string;
  sessionEnv: string;
  sessionFile: string;
};

function resolveJobrightAuth(): JobrightAuth {
  const prefix = getActiveProfile().jobrightEnvPrefix;
  if (prefix) {
    const emailEnv = `${prefix}_EMAIL`;
    const passwordEnv = `${prefix}_PASSWORD`;
    const sessionEnv = `${prefix}_SESSION_ID`;
    const slug = prefix.replace(/_JOBRIGHT$/i, "").toLowerCase();
    return {
      email: (process.env[emailEnv] || "").trim(),
      password: (process.env[passwordEnv] || "").trim(),
      sessionId: (process.env[sessionEnv] || "").trim(),
      emailEnv,
      passwordEnv,
      sessionEnv,
      sessionFile: `jobright-session-${slug}.json`,
    };
  }
  return {
    email: config.jobrightEmail,
    password: config.jobrightPassword,
    sessionId: config.jobrightSessionId,
    emailEnv: "JOBRIGHT_EMAIL",
    passwordEnv: "JOBRIGHT_PASSWORD",
    sessionEnv: "JOBRIGHT_SESSION_ID",
    sessionFile: "jobright-session.json",
  };
}

function sessionFilePath(auth: JobrightAuth): string {
  return path.join(config.dataDir, auth.sessionFile);
}

function loadPersistedSession(auth: JobrightAuth): string {
  try {
    const raw = fs.readFileSync(sessionFilePath(auth), "utf8");
    const data = JSON.parse(raw) as { sessionId?: string };
    return (data.sessionId || "").trim();
  } catch {
    return "";
  }
}

function savePersistedSession(auth: JobrightAuth, sessionId: string): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(
    sessionFilePath(auth),
    JSON.stringify({ sessionId, savedAt: new Date().toISOString() }, null, 2) + "\n",
    "utf8",
  );
}

export function isJobrightConfigured(): boolean {
  const auth = resolveJobrightAuth();
  return Boolean(
    auth.sessionId || loadPersistedSession(auth) || (auth.email && auth.password),
  );
}

function cookieHeader(sessionId: string): Record<string, string> {
  return { cookie: `SESSION_ID=${sessionId}` };
}

function extractSessionIdFromSetCookie(header: string | null): string {
  if (!header) return "";
  const match = header.match(/SESSION_ID=([^;]+)/i);
  return match?.[1]?.trim() ?? "";
}

async function login(auth: JobrightAuth): Promise<string> {
  if (!auth.email || !auth.password) {
    throw new Error(
      `JobRight credentials missing (set ${auth.emailEnv} + ${auth.passwordEnv})`,
    );
  }

  progress("JobRight: logging in…");
  const res = await httpPostJson(
    `${API_BASE}/swan/auth/login/pwd`,
    {
      email: auth.email,
      password: auth.password,
    },
    {
      headers: {
        origin: "https://jobright.ai",
        referer: "https://jobright.ai/",
        accept: "application/json",
      },
    },
  );

  const data = (await res.json()) as {
    success?: boolean;
    message?: string;
    errorMsg?: string;
    errorCode?: number;
  };
  if (!res.ok || !data.success) {
    const detail = data.errorMsg || data.message || `HTTP ${res.status}`;
    throw new Error(`JobRight login failed: ${detail}`);
  }

  const sessionId =
    extractSessionIdFromSetCookie(res.headers.get("set-cookie")) ||
    // undici may expose multiple Set-Cookie via getSetCookie when available
    (typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie ===
    "function"
      ? (res.headers as Headers & { getSetCookie: () => string[] })
          .getSetCookie()
          .map((c) => extractSessionIdFromSetCookie(c))
          .find(Boolean) || ""
      : "");

  if (!sessionId) {
    throw new Error("JobRight login succeeded but no SESSION_ID cookie returned");
  }

  savePersistedSession(auth, sessionId);
  progress("JobRight: login ok");
  return sessionId;
}

async function validateSession(sessionId: string): Promise<boolean> {
  try {
    const url = `${API_BASE}/swan/recommend/list/jobs?position=0&count=1`;
    const res = await httpGet(url, { headers: cookieHeader(sessionId) });
    if (res.status === 401 || res.status === 403) return false;
    const data = (await res.json()) as RecommendResponse;
    return Boolean(data.success);
  } catch {
    return false;
  }
}

async function ensureSession(forceRelogin = false): Promise<string> {
  const auth = resolveJobrightAuth();
  if (!forceRelogin) {
    const persisted = loadPersistedSession(auth);
    const candidates = [auth.sessionId, persisted].filter(Boolean);

    for (const sessionId of candidates) {
      if (await validateSession(sessionId)) {
        if (sessionId !== persisted) savePersistedSession(auth, sessionId);
        return sessionId;
      }
    }
  }

  return login(auth);
}

async function fetchRecommendationPage(
  sessionId: string,
  position: number,
  refresh: boolean,
): Promise<JobrightApiJob[] | null> {
  const url = new URL(`${API_BASE}/swan/recommend/list/jobs`);
  url.searchParams.set("position", String(position));
  url.searchParams.set("count", String(PAGE_SIZE));
  if (refresh) url.searchParams.set("refresh", "true");

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const res = await httpGet(url.toString(), { headers: cookieHeader(sessionId) });

    if (res.status === 401) {
      throw new SessionExpiredError("JobRight returned 401 — session expired");
    }

    if (res.status === 403 || res.status === 429) {
      if (attempt < MAX_RETRIES) {
        const wait = RETRY_BACKOFF_MS[attempt] ?? 90_000;
        progress(
          `JobRight: HTTP ${res.status} at position=${position}, waiting ${wait / 1000}s…`,
        );
        await sleep(wait);
        continue;
      }
      progress(`JobRight: rate limited at position=${position} — stopping`);
      return null;
    }

    if (!res.ok) {
      throw new Error(`JobRight HTTP ${res.status} at position=${position}`);
    }

    const data = (await res.json()) as RecommendResponse;
    if (!data.success) {
      const msg = data.message || "";
      if (/login|auth|session/i.test(msg)) {
        throw new SessionExpiredError(`JobRight API auth error: ${msg}`);
      }
      throw new Error(`JobRight API error: ${msg || JSON.stringify(data)}`);
    }

    return data.result?.jobList ?? [];
  }

  return null;
}

function isLinkedInJobUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "linkedin.com" || host.endsWith(".linkedin.com");
  } catch {
    return /linkedin\.com/i.test(url);
  }
}

function parseJob(raw: JobrightApiJob): JobRecord | null {
  const jr = raw.jobResult ?? {};
  const cr = raw.companyResult ?? {};
  const jobId = (jr.jobId || "").trim();
  const title = (jr.jobTitle || "").trim();
  const company = (cr.companyName || "").trim();
  if (!title || !company) return null;

  const listingUrl = jobId ? `${SITE_BASE}/jobs/info/${jobId}` : "";
  const applyLink = (jr.applyLink || "").trim();
  // Skip LinkedIn-only applies — do not substitute the JobRight listing URL.
  if (applyLink && isLinkedInJobUrl(applyLink)) return null;

  const jobLink = applyLink || listingUrl;
  if (!jobLink) return null;

  const employmentType = normalizeEmploymentType(jr.employmentType);

  const job: JobRecord = {
    company,
    title,
    jobLink,
    listingUrl: listingUrl || undefined,
    source: "jobright",
    externalId: jobId || undefined,
    ...(employmentType ? { employmentType } : {}),
  };
  if (shouldSkipJob(job)) return null;
  return job;
}

function maxJobsWanted(): number {
  if (config.maxPages > 0) return config.maxPages * PAGE_SIZE;
  return config.jobrightMaxJobs > 0 ? config.jobrightMaxJobs : 100;
}

function maxPagesToScan(): number {
  if (config.maxPages > 0) return config.maxPages;
  return Math.ceil(maxJobsWanted() / PAGE_SIZE) + 2;
}

/** Personalized recommendations from the active profile’s JobRight account. */
export async function fetchJobrightJobs(): Promise<FetchResult> {
  const auth = resolveJobrightAuth();
  if (!isJobrightConfigured()) {
    return {
      source: "jobright",
      jobs: [],
      pagesFetched: 0,
      error: `JobRight not configured (set ${auth.emailEnv} + ${auth.passwordEnv}, or ${auth.sessionEnv})`,
    };
  }

  const jobs: JobRecord[] = [];
  const seenIds = new Set<string>();
  let pagesFetched = 0;
  let reauthAttempted = false;

  try {
    let sessionId = await ensureSession();
    const wanted = maxJobsWanted();
    const maxPages = maxPagesToScan();
    let position = 0;
    let emptyPages = 0;
    progress(`JobRight: fetching up to ${wanted} recommended job(s)…`);

    while (jobs.length < wanted && pagesFetched < maxPages) {
      if (position > 0 && config.jobrightPageDelayMs > 0) {
        await sleep(config.jobrightPageDelayMs);
      }

      let rawList: JobrightApiJob[] | null;
      try {
        rawList = await fetchRecommendationPage(sessionId, position, position === 0);
      } catch (err) {
        if (err instanceof SessionExpiredError && !reauthAttempted) {
          progress("JobRight: session expired — re-logging in…");
          reauthAttempted = true;
          sessionId = await ensureSession(true);
          continue;
        }
        throw err;
      }

      pagesFetched += 1;

      if (rawList === null) break;

      if (rawList.length === 0) {
        emptyPages += 1;
        if (emptyPages >= 2) break;
        position += PAGE_SIZE;
        continue;
      }
      emptyPages = 0;

      for (const raw of rawList) {
        const job = parseJob(raw);
        if (!job) continue;
        const key = job.externalId || job.jobLink;
        if (seenIds.has(key)) continue;
        seenIds.add(key);
        jobs.push(job);
        if (jobs.length >= wanted) break;
      }

      progress(`JobRight: ${jobs.length} job(s) (position=${position})`);
      position += PAGE_SIZE;
    }

    return { source: "jobright", jobs: jobs.slice(0, wanted), pagesFetched };
  } catch (err) {
    return {
      source: "jobright",
      jobs,
      pagesFetched,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

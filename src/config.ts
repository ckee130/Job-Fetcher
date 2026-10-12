import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(rootDir, ".env") });
dotenv.config({ path: path.join(rootDir, ".env.local") });

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export const config = {
  rootDir,
  dataDir: path.join(rootDir, "data"),
  outputDir: path.join(rootDir, "output"),
  proxyUrl: (process.env.PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "").trim(),
  maxPages: intEnv("MAX_PAGES", 0),
  pageDelayMs: intEnv("PAGE_DELAY_MS", 400),
  notify: boolEnv("NOTIFY", true),
  googleSpreadsheetId: (process.env.GOOGLE_SPREADSHEET_ID || "").trim(),
  googleServiceAccountFile: (process.env.GOOGLE_SERVICE_ACCOUNT_FILE || "").trim(),
  /** CV folder; `{sheet}` → active profile name. Skip job if a filename contains the company. */
  cvDir: (process.env.CV_DIR || "").trim(),
  /** JobRight.ai account — used by every profile alongside Built In. */
  jobrightEmail: (process.env.JOBRIGHT_EMAIL || "").trim(),
  jobrightPassword: (process.env.JOBRIGHT_PASSWORD || "").trim(),
  /** Optional seed session; otherwise login + persist under data/. */
  jobrightSessionId: (process.env.JOBRIGHT_SESSION_ID || "").trim(),
  /** Cap JobRight recommendation jobs (0 = default 100). */
  jobrightMaxJobs: intEnv("JOBRIGHT_MAX_JOBS", 100),
  /** Delay between JobRight recommendation pages (rate limits are strict). */
  jobrightPageDelayMs: intEnv("JOBRIGHT_PAGE_DELAY_MS", 7000),
  /**
   * How long to wait for a manual Hiring Cafe bot check in the headed browser (ms).
   * Default 5 minutes.
   */
  hiringCafeChallengeTimeoutMs: intEnv("HIRINGCAFE_CHALLENGE_TIMEOUT_MS", 300_000),
  /**
   * Use PROXY_URL for the Hiring Cafe browser. Default off — datacenter proxies often trigger 403.
   */
  hiringCafeUseProxy: boolEnv("HIRINGCAFE_USE_PROXY", false),
  /** Quiet wait between Built In login checks (ms). Default 1 minute. */
  builtinLoginWaitMs: intEnv("BUILTIN_LOGIN_WAIT_MS", 60_000),
  /** How many times to wait-then-check for Built In login. */
  builtinLoginAttempts: intEnv("BUILTIN_LOGIN_ATTEMPTS", 5),
  /** Parallel headed tabs for Built In apply-URL resolution after login. */
  builtinApplyConcurrency: intEnv("BUILTIN_APPLY_CONCURRENCY", 4),
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

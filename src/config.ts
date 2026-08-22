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
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

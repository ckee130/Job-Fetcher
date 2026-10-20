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

export const config = {
  rootDir,
  dataDir: path.join(rootDir, "data"),
  /** Chrome extension server. Token falls back to data/extension-token.txt. */
  extensionPort: intEnv("EXTENSION_PORT", 3921),
  extensionToken: (process.env.EXTENSION_TOKEN || "").trim(),
  googleSpreadsheetId: (process.env.GOOGLE_SPREADSHEET_ID || "").trim(),
  googleServiceAccountFile: (process.env.GOOGLE_SERVICE_ACCOUNT_FILE || "").trim(),
  /** CV folder; `{sheet}` → active profile name. Skip job if a filename contains the company. */
  cvDir: (process.env.CV_DIR || "").trim(),
};

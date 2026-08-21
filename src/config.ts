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

/** Built In remote engineering filters matching the user's saved search. */
export const BUILTIN_SEARCH_PATH =
  "/jobs/remote/engineering/software-engineering/devops-platform-engineering/qa-test-engineering/security-engineering/automation-controls-engineering/mid-level/senior/expert-leader";

export const BUILTIN_SEARCH_PARAMS = {
  daysSinceUpdated: "1",
  country: "USA",
  allLocations: "true",
} as const;

/**
 * Hiring Cafe searchState matching the user's saved URL
 * (US + Remote, last 2 days, engineering departments, 5–10 YoE, IC).
 */
export const HIRINGCAFE_SEARCH_STATE = {
  locations: [
    {
      id: "FxY1yZQBoEtHp_8UEq7V",
      types: ["country"],
      address_components: [
        {
          long_name: "United States",
          short_name: "US",
          types: ["country"],
        },
      ],
      formatted_address: "United States",
      population: 327167434,
      workplace_types: ["Remote"],
      options: { flexible_regions: [] as string[] },
    },
  ],
  commitmentTypes: ["Full Time", "Contract", "Part Time", "Temporary", "Seasonal"],
  dateFetchedPastNDays: 2,
  departments: [
    "Software Development",
    "Data and Analytics",
    "Engineering",
    "Information Technology",
  ],
  roleYoeRange: [5, 10],
  roleTypes: ["Individual Contributor"],
  excludeAllLicensesAndCertifications: true,
  securityClearances: ["None"],
  sortBy: "date",
} as const;

export const config = {
  rootDir,
  dataDir: path.join(rootDir, "data"),
  outputDir: path.join(rootDir, "output"),
  seenJobsPath: path.join(rootDir, "data", "seen-jobs.json"),
  proxyUrl: (process.env.PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "").trim(),
  maxPages: intEnv("MAX_PAGES", 0),
  pageDelayMs: intEnv("PAGE_DELAY_MS", 400),
  notify: boolEnv("NOTIFY", true),
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

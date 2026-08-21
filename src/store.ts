import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { JobRecord } from "./types.js";

type SeenStore = {
  updatedAt: string;
  /** jobLink -> firstSeen ISO timestamp */
  links: Record<string, string>;
};

function emptyStore(): SeenStore {
  return { updatedAt: new Date().toISOString(), links: {} };
}

export function loadSeenStore(): SeenStore {
  try {
    if (!fs.existsSync(config.seenJobsPath)) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(config.seenJobsPath, "utf8")) as SeenStore;
    if (!raw || typeof raw !== "object" || typeof raw.links !== "object") return emptyStore();
    return raw;
  } catch {
    return emptyStore();
  }
}

export function saveSeenStore(store: SeenStore): void {
  fs.mkdirSync(path.dirname(config.seenJobsPath), { recursive: true });
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(config.seenJobsPath, JSON.stringify(store, null, 2) + "\n", "utf8");
}

/** Keep only jobs whose link has never been seen; mark them as seen. */
export function filterNewJobs(jobs: JobRecord[]): {
  newJobs: JobRecord[];
  skippedDuplicates: number;
} {
  const store = loadSeenStore();
  const newJobs: JobRecord[] = [];
  let skippedDuplicates = 0;
  const now = new Date().toISOString();

  for (const job of jobs) {
    const key = job.jobLink.trim();
    if (!key) continue;
    if (store.links[key]) {
      skippedDuplicates += 1;
      continue;
    }
    store.links[key] = now;
    newJobs.push(job);
  }

  if (newJobs.length > 0) {
    saveSeenStore(store);
  }

  return { newJobs, skippedDuplicates };
}

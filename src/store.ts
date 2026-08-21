import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { JobRecord } from "./types.js";

type SeenStore = {
  updatedAt: string;
  /** Stable keys (source:id, listing URL, and/or apply URL) -> firstSeen ISO */
  links: Record<string, string>;
};

function emptyStore(): SeenStore {
  return { updatedAt: new Date().toISOString(), links: {} };
}

/** All keys that should mark a job as already processed. */
export function seenKeysFor(job: JobRecord): string[] {
  const keys: string[] = [];
  if (job.externalId) keys.push(`${job.source}:${job.externalId}`);
  if (job.listingUrl?.trim()) keys.push(job.listingUrl.trim());
  if (job.jobLink.trim()) keys.push(job.jobLink.trim());
  return [...new Set(keys)];
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

/** Keep only jobs that have never been seen; mark them as seen. */
export function filterNewJobs(jobs: JobRecord[]): {
  newJobs: JobRecord[];
  skippedDuplicates: number;
} {
  const store = loadSeenStore();
  const newJobs: JobRecord[] = [];
  let skippedDuplicates = 0;
  const now = new Date().toISOString();

  for (const job of jobs) {
    const keys = seenKeysFor(job);
    if (keys.length === 0) continue;
    if (keys.some((k) => store.links[k])) {
      skippedDuplicates += 1;
      continue;
    }
    for (const k of keys) store.links[k] = now;
    newJobs.push(job);
  }

  if (newJobs.length > 0) {
    saveSeenStore(store);
  }

  return { newJobs, skippedDuplicates };
}

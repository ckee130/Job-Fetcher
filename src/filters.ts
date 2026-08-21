import type { JobRecord } from "./types.js";

/** Titles to skip for IC-focused accuracy. Extend as needed. */
const TITLE_EXCLUDE = [/\bmanagers?\b/i, /\bdirectors?\b/i, /\bdesigners?\b/i] as const;

export function shouldSkipJob(job: Pick<JobRecord, "title">): boolean {
  const title = job.title.trim();
  if (!title) return true;
  return TITLE_EXCLUDE.some((re) => re.test(title));
}

export function filterJobsByTitle(jobs: JobRecord[]): {
  kept: JobRecord[];
  skipped: number;
} {
  const kept: JobRecord[] = [];
  let skipped = 0;
  for (const job of jobs) {
    if (shouldSkipJob(job)) {
      skipped += 1;
      continue;
    }
    kept.push(job);
  }
  return { kept, skipped };
}

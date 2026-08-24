import { normalizeCompany } from "./sheets.js";
import type { JobRecord } from "./types.js";

const AGGREGATOR_HOST = /(?:^|\.)hiringcafe\.com$|(?:^|\.)builtin\.com$/i;

const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gh_src",
  "gh_jid",
  "source",
  "ref",
  "referrer",
] as const;

/** Normalize employer apply URL for cross-platform matching. */
export function normalizeApplyUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    if (AGGREGATOR_HOST.test(u.hostname)) return "";

    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";

    const search = u.searchParams.toString();
    return `${u.protocol}//${u.hostname}${u.pathname}${search ? `?${search}` : ""}`;
  } catch {
    return "";
  }
}

/** Keys that identify the same job across Hiring Cafe and Built In. */
export function crossPlatformKeys(job: JobRecord): string[] {
  const keys: string[] = [];
  const apply = normalizeApplyUrl(job.jobLink);
  if (apply) keys.push(`url:${apply}`);
  const company = normalizeCompany(job.company);
  if (company) keys.push(`co:${company}`);
  return keys;
}

/**
 * Drop jobs already seen on another platform in this run.
 * Hiring Cafe is listed before Built In, so it wins when both have the same job.
 */
export function dedupeCrossPlatform(jobs: JobRecord[]): {
  kept: JobRecord[];
  skipped: number;
} {
  const seenKeys = new Set<string>();
  const kept: JobRecord[] = [];
  let skipped = 0;

  for (const job of jobs) {
    const keys = crossPlatformKeys(job);
    if (keys.some((k) => seenKeys.has(k))) {
      skipped += 1;
      continue;
    }
    kept.push(job);
    for (const k of keys) seenKeys.add(k);
  }

  return { kept, skipped };
}

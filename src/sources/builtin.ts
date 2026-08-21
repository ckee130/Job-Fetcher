import { BUILTIN_SEARCH_PARAMS, BUILTIN_SEARCH_PATH, config } from "../config.js";
import { httpGet, sleep } from "../http.js";
import type { FetchResult, JobRecord } from "../types.js";

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, "")).trim();
}

function buildPageUrl(page: number): string {
  const url = new URL(BUILTIN_SEARCH_PATH, "https://builtin.com");
  for (const [k, v] of Object.entries(BUILTIN_SEARCH_PARAMS)) {
    url.searchParams.set(k, v);
  }
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

function parseJobsFromHtml(html: string): JobRecord[] {
  const parts = html.split(/id="job-card-(\d+)"/);
  const jobs: JobRecord[] = [];

  for (let i = 1; i < parts.length; i += 2) {
    const id = parts[i]!;
    const chunk = parts[i + 1] ?? "";
    const companyMatch = chunk.match(/data-id="company-title"[^>]*>\s*<span>(.*?)<\/span>/s);
    const titleMatch = chunk.match(/data-alias="(\/job\/[^"]+)"[^>]*>(.*?)<\/a>/s);
    if (!companyMatch || !titleMatch) continue;

    const company = stripTags(companyMatch[1] ?? "");
    const title = stripTags(titleMatch[2] ?? "");
    const path = titleMatch[1] ?? "";
    if (!company || !title || !path) continue;

    const listingUrl = `https://builtin.com${path}`;
    jobs.push({
      company,
      title,
      jobLink: listingUrl,
      listingUrl,
      source: "builtin",
      externalId: id,
    });
  }

  return jobs;
}

function detectMaxPage(html: string): number {
  const pages = [...html.matchAll(/aria-label="Go to [Pp]age (\d+)"/g)].map((m) =>
    Number(m[1]),
  );
  return pages.length ? Math.max(...pages) : 1;
}

/** Extract employer apply URL from Built In job detail HTML (`howToApply`). */
function extractHowToApply(html: string): string | null {
  const init = html.match(/Builtin\.jobPostInit\((\{.*?\})\)\s*;/s);
  if (init?.[1]) {
    try {
      const payload = JSON.parse(init[1]) as { job?: { howToApply?: string } };
      const apply = payload.job?.howToApply?.trim();
      if (apply && /^https?:\/\//i.test(apply)) return apply;
    } catch {
      // fall through to regex
    }
  }

  const m = html.match(/"howToApply"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!m?.[1]) return null;
  const raw = m[1]
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\\//g, "/");
  return /^https?:\/\//i.test(raw) ? raw : null;
}

async function resolveApplyUrl(listingUrl: string): Promise<string | null> {
  const res = await httpGet(listingUrl);
  if (!res.ok) return null;
  const html = await res.text();
  return extractHowToApply(html);
}

/** Resolve employer apply URLs for Built In listings (detail page required). */
async function enrichWithApplyUrls(jobs: JobRecord[]): Promise<void> {
  const concurrency = 4;
  for (let i = 0; i < jobs.length; i += concurrency) {
    const batch = jobs.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (job) => {
        if (!job.listingUrl) return;
        try {
          const apply = await resolveApplyUrl(job.listingUrl);
          if (apply) job.jobLink = apply;
        } catch {
          // keep listing URL
        }
      }),
    );
    if (i + concurrency < jobs.length && config.pageDelayMs > 0) {
      await sleep(config.pageDelayMs);
    }
  }
}

export async function fetchBuiltinJobs(): Promise<FetchResult> {
  const jobs: JobRecord[] = [];
  const seenIds = new Set<string>();
  let pagesFetched = 0;

  try {
    const firstUrl = buildPageUrl(1);
    const firstRes = await httpGet(firstUrl);
    if (!firstRes.ok) throw new Error(`HTTP ${firstRes.status} for ${firstUrl}`);
    const firstHtml = await firstRes.text();
    pagesFetched += 1;

    for (const job of parseJobsFromHtml(firstHtml)) {
      const key = job.externalId || job.jobLink;
      if (seenIds.has(key)) continue;
      seenIds.add(key);
      jobs.push(job);
    }

    let maxPage = detectMaxPage(firstHtml);
    if (config.maxPages > 0) maxPage = Math.min(maxPage, config.maxPages);

    for (let page = 2; page <= maxPage; page += 1) {
      if (config.pageDelayMs > 0) await sleep(config.pageDelayMs);
      const url = buildPageUrl(page);
      const res = await httpGet(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const html = await res.text();
      pagesFetched += 1;

      const pageJobs = parseJobsFromHtml(html);
      if (pageJobs.length === 0) break;

      for (const job of pageJobs) {
        const key = job.externalId || job.jobLink;
        if (seenIds.has(key)) continue;
        seenIds.add(key);
        jobs.push(job);
      }
    }

    await enrichWithApplyUrls(jobs);

    return { source: "builtin", jobs, pagesFetched };
  } catch (err) {
    return {
      source: "builtin",
      jobs,
      pagesFetched,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

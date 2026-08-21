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

    jobs.push({
      company,
      title,
      jobLink: `https://builtin.com${path}`,
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

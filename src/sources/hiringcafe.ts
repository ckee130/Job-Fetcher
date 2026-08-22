import { config } from "../config.js";
import { getActiveProfile } from "../profiles.js";
import { shouldSkipJob } from "../filters.js";
import { httpGet, sleep } from "../http.js";
import { progress } from "../progress.js";
import type { FetchResult, JobRecord } from "../types.js";

type HcHit = {
  id?: string;
  objectID?: string;
  apply_url?: string;
  requisition_id?: string;
  job_information?: { title?: string; job_title_raw?: string };
  v5_processed_job_data?: { company_name?: string; core_job_title?: string };
  enriched_company_data?: { name?: string };
};

type NextData = {
  props?: {
    pageProps?: {
      ssrHits?: HcHit[];
      ssrPage?: number;
      ssrTotalCount?: number;
      ssrPageSize?: number;
      ssrIsLastPage?: boolean;
      ssrError?: string | null;
    };
  };
};

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

function extractNextData(html: string): NextData {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!match?.[1]) {
    throw new Error("Hiring Cafe page missing __NEXT_DATA__ (blocked or layout changed)");
  }
  return JSON.parse(match[1]) as NextData;
}

/** Map requisition_id / object suffix -> /job/... slug found in HTML. */
function extractJobSlugs(html: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /href="(\/job\/[^"#?]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const path = m[1]!;
    const slug = path.split("/").pop() ?? "";
    const parts = slug.split("-");
    const suffix = parts[parts.length - 1] ?? "";
    if (suffix) map.set(suffix, path);
  }
  return map;
}

function buildSearchUrl(page: number): string {
  const url = new URL("https://hiringcafe.com/");
  url.searchParams.set("searchState", JSON.stringify(getActiveProfile().hiringCafe));
  if (page > 0) url.searchParams.set("page", String(page));
  return url.toString();
}

function normalizeHit(hit: HcHit, slugBySuffix: Map<string, string>): JobRecord | null {
  const title =
    hit.job_information?.title?.trim() ||
    hit.job_information?.job_title_raw?.trim() ||
    hit.v5_processed_job_data?.core_job_title?.trim() ||
    "";
  const company =
    hit.v5_processed_job_data?.company_name?.trim() ||
    hit.enriched_company_data?.name?.trim() ||
    "";

  const req = hit.requisition_id?.trim() || "";
  const slugPath = req ? slugBySuffix.get(req) : undefined;
  const listingUrl = slugPath ? `https://hiringcafe.com${slugPath}` : undefined;
  const applyUrl = hit.apply_url?.trim() || "";
  const jobLink = applyUrl || listingUrl || "";

  if (!title || !company || !jobLink) return null;

  const job: JobRecord = {
    company: decodeHtmlEntities(company),
    title: decodeHtmlEntities(title),
    jobLink,
    listingUrl,
    source: "hiringcafe",
    externalId: hit.id || hit.objectID || req || undefined,
  };
  if (shouldSkipJob(job)) return null;
  return job;
}

export async function fetchHiringCafeJobs(): Promise<FetchResult> {
  const jobs: JobRecord[] = [];
  const seenIds = new Set<string>();
  let pagesFetched = 0;
  let page = 0;

  try {
    while (true) {
      if (config.maxPages > 0 && pagesFetched >= config.maxPages) break;

      const url = buildSearchUrl(page);
      const res = await httpGet(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      const html = await res.text();
      const next = extractNextData(html);
      const pp = next.props?.pageProps;
      if (!pp) throw new Error("Hiring Cafe pageProps missing");
      if (pp.ssrError) throw new Error(String(pp.ssrError));

      const hits = Array.isArray(pp.ssrHits) ? pp.ssrHits : [];
      const slugBySuffix = extractJobSlugs(html);
      pagesFetched += 1;

      for (const hit of hits) {
        const job = normalizeHit(hit, slugBySuffix);
        if (!job) continue;
        const dedupeKey = job.externalId || job.jobLink;
        if (seenIds.has(dedupeKey)) continue;
        seenIds.add(dedupeKey);
        jobs.push(job);
      }

      const isLast =
        pp.ssrIsLastPage === true ||
        hits.length === 0 ||
        (typeof pp.ssrPageSize === "number" && hits.length < pp.ssrPageSize);

      const totalHint =
        typeof pp.ssrTotalCount === "number" ? ` / ~${pp.ssrTotalCount} listings` : "";
      progress(
        `Hiring Cafe page ${pagesFetched}: +${hits.length} hits → ${jobs.length} kept${totalHint}${isLast ? " (done)" : ""}`,
      );

      if (isLast) break;
      page += 1;
      if (config.pageDelayMs > 0) await sleep(config.pageDelayMs);
    }

    return { source: "hiringcafe", jobs, pagesFetched };
  } catch (err) {
    return {
      source: "hiringcafe",
      jobs,
      pagesFetched,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { config } from "../config.js";
import { getActiveProfile } from "../profiles.js";
import { shouldSkipJob } from "../filters.js";
import { sleep } from "../http.js";
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

type PageProps = {
  ssrHits?: HcHit[];
  ssrPage?: number;
  ssrTotalCount?: number;
  ssrPageSize?: number;
  ssrIsLastPage?: boolean;
  ssrError?: string | null;
};

type NextData = {
  props?: {
    pageProps?: PageProps;
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
  const profile = getActiveProfile();
  const path = (profile.hiringCafePath || "/").trim() || "/";
  const url = new URL(path, "https://hiringcafe.com");
  url.searchParams.set("searchState", JSON.stringify(profile.hiringCafe));
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

function playwrightProxyFromUrl(proxyUrl: string):
  | { server: string; username?: string; password?: string }
  | undefined {
  if (!proxyUrl) return undefined;
  try {
    const u = new URL(proxyUrl);
    const server = `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ""}`;
    const username = u.username ? decodeURIComponent(u.username) : undefined;
    const password = u.password ? decodeURIComponent(u.password) : undefined;
    return username ? { server, username, password } : { server };
  } catch {
    return { server: proxyUrl };
  }
}

async function waitForHiringCafeReady(page: Page, timeoutMs: number): Promise<void> {
  progress(
    `Hiring Cafe: waiting up to ${Math.round(timeoutMs / 1000)}s — complete any bot check in the browser window…`,
  );

  await page.waitForFunction(
    () => {
      const el = document.querySelector("#__NEXT_DATA__");
      if (!el?.textContent) return false;
      try {
        const data = JSON.parse(el.textContent) as {
          props?: { pageProps?: Record<string, unknown> | null };
        };
        return Boolean(data?.props?.pageProps);
      } catch {
        return false;
      }
    },
    { timeout: timeoutMs },
  );
}

async function readPageJobs(
  page: Page,
): Promise<{ hits: HcHit[]; props: PageProps; html: string }> {
  const html = await page.content();
  const next = extractNextData(html);
  const props = next.props?.pageProps;
  if (!props) throw new Error("Hiring Cafe pageProps missing");
  if (props.ssrError) throw new Error(String(props.ssrError));
  const hits = Array.isArray(props.ssrHits) ? props.ssrHits : [];
  return { hits, props, html };
}

export async function fetchHiringCafeJobs(): Promise<FetchResult> {
  const jobs: JobRecord[] = [];
  const seenIds = new Set<string>();
  let pagesFetched = 0;
  let pageNo = 0;

  let browser: Browser | null = null;

  try {
    const proxy = playwrightProxyFromUrl(config.proxyUrl);

    progress(
      `Hiring Cafe: opening headed browser${proxy ? " (via proxy)" : " (direct)"}…`,
    );

    browser = await chromium.launch({
      headless: false,
      channel: undefined,
      args: ["--disable-blink-features=AutomationControlled"],
    });

    const context: BrowserContext = await browser.newContext({
      userAgent: config.userAgent,
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
      ...(proxy ? { proxy } : {}),
    });

    const page = await context.newPage();
    page.setDefaultTimeout(config.hiringCafeChallengeTimeoutMs);

    while (true) {
      if (config.maxPages > 0 && pagesFetched >= config.maxPages) break;

      const url = buildSearchUrl(pageNo);
      progress(`Hiring Cafe: navigating page ${pageNo}…`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });

      try {
        await waitForHiringCafeReady(page, config.hiringCafeChallengeTimeoutMs);
      } catch {
        throw new Error(
          `Timed out waiting for Hiring Cafe after bot check (${Math.round(config.hiringCafeChallengeTimeoutMs / 1000)}s). Complete the challenge in the open browser and re-run.`,
        );
      }

      const { hits, props, html } = await readPageJobs(page);
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
        props.ssrIsLastPage === true ||
        hits.length === 0 ||
        (typeof props.ssrPageSize === "number" && hits.length < props.ssrPageSize);

      const totalHint =
        typeof props.ssrTotalCount === "number" ? ` / ~${props.ssrTotalCount} listings` : "";
      progress(
        `Hiring Cafe page ${pagesFetched}: +${hits.length} hits → ${jobs.length} kept${totalHint}${isLast ? " (done)" : ""}`,
      );

      if (isLast) break;
      pageNo += 1;
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
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}

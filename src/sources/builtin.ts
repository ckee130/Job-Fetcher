import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { config } from "../config.js";
import { normalizeEmploymentType } from "../employment.js";
import { getActiveProfile, type BuiltinSearch } from "../profiles.js";
import { shouldSkipJob } from "../filters.js";
import { httpGet, sleep } from "../http.js";
import { progress } from "../progress.js";
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

function buildPageUrl(search: BuiltinSearch, page: number): string {
  const url = new URL(search.path, "https://builtin.com");
  for (const [k, v] of Object.entries(search.params)) {
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
    const job: JobRecord = {
      company,
      title,
      jobLink: listingUrl,
      listingUrl,
      source: "builtin",
      externalId: id,
    };
    if (shouldSkipJob(job)) continue;
    jobs.push(job);
  }

  return jobs;
}

function detectMaxPage(html: string): number {
  const pages = [...html.matchAll(/aria-label="Go to [Pp]age (\d+)"/g)].map((m) =>
    Number(m[1]),
  );
  return pages.length ? Math.max(...pages) : 1;
}

type JobPostInit = {
  job?: {
    howToApply?: string;
    applyUrl?: string;
    applyText?: string;
    isEasyApply?: boolean;
  };
  isLoggedIn?: boolean;
  isApplyFormEnabled?: boolean;
};

function parseJobPostInit(html: string): JobPostInit | null {
  const init = html.match(/Builtin\.jobPostInit\((\{.*?\})\)\s*;/s);
  if (!init?.[1]) return null;
  try {
    return JSON.parse(init[1]) as JobPostInit;
  } catch {
    return null;
  }
}

function toAbsoluteBuiltinUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `https://builtin.com${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

function isBuiltinHost(url: string): boolean {
  try {
    return /(?:^|\.)builtin\.com$/i.test(new URL(url).hostname);
  } catch {
    return /builtin\.com/i.test(url);
  }
}

/** Schema.org JobPosting employmentType from detail-page LD+JSON (e.g. FULL_TIME). */
function extractEmploymentTypeFromBuiltinHtml(html: string): string | undefined {
  const matches = html.matchAll(/"employmentType"\s*:\s*"([^"]+)"/g);
  for (const m of matches) {
    const normalized = normalizeEmploymentType(m[1]);
    if (normalized) return normalized;
  }
  return undefined;
}

/** Built In replaced public howToApply with applyUrl → ApplyRedirect (login often required). */
function extractApplyRedirectUrl(html: string): string | null {
  const payload = parseJobPostInit(html);
  const fromInit =
    payload?.job?.howToApply?.trim() || payload?.job?.applyUrl?.trim() || "";
  if (fromInit) return toAbsoluteBuiltinUrl(fromInit);

  const m = html.match(/"applyUrl"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!m?.[1]) return null;
  const raw = m[1]
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\\//g, "/");
  return raw ? toAbsoluteBuiltinUrl(raw) : null;
}

function searchLabel(search: BuiltinSearch): string {
  const slug = search.path.split("/").filter(Boolean).slice(-2).join("/");
  return slug || search.path;
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

/** Headed browser used only for apply-URL resolution (listings use HTTP). */
let sharedBrowser: Browser | null = null;
let sharedContext: BrowserContext | null = null;

async function ensureBrowserContext(): Promise<BrowserContext> {
  if (sharedContext && sharedBrowser) return sharedContext;

  const proxyUrl = config.proxyUrl;
  const proxy = playwrightProxyFromUrl(proxyUrl);
  progress(
    `Built In: opening headed browser for apply URLs${proxy ? " (via proxy)" : " (direct)"}…`,
  );

  sharedBrowser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  sharedContext = await sharedBrowser.newContext({
    userAgent: config.userAgent,
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    ...(proxy ? { proxy } : {}),
  });
  return sharedContext;
}

export async function closeBuiltinBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => undefined);
  }
  sharedBrowser = null;
  sharedContext = null;
}

async function fetchOneBuiltinSearchHttp(
  search: BuiltinSearch,
  searchIndex: number,
  searchTotal: number,
  seenIds: Set<string>,
  jobs: JobRecord[],
): Promise<number> {
  let pagesFetched = 0;
  const label = searchLabel(search);
  progress(`Built In [${searchIndex}/${searchTotal}] ${label}`);

  const firstUrl = buildPageUrl(search, 1);
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
  progress(`  page 1/${maxPage}: ${jobs.length} jobs total`);

  for (let pageNo = 2; pageNo <= maxPage; pageNo += 1) {
    if (config.pageDelayMs > 0) await sleep(config.pageDelayMs);
    const url = buildPageUrl(search, pageNo);
    const res = await httpGet(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const html = await res.text();
    pagesFetched += 1;

    const pageJobs = parseJobsFromHtml(html);
    if (pageJobs.length === 0) {
      progress(`  page ${pageNo}/${maxPage}: empty — stopping this search`);
      break;
    }

    for (const job of pageJobs) {
      const key = job.externalId || job.jobLink;
      if (seenIds.has(key)) continue;
      seenIds.add(key);
      jobs.push(job);
    }
    progress(`  page ${pageNo}/${maxPage}: ${jobs.length} jobs total`);
  }

  return pagesFetched;
}

/** Fast listing fetch over HTTP (no browser). */
export async function fetchBuiltinJobs(): Promise<FetchResult> {
  const searches = getActiveProfile().builtinSearches;
  const jobs: JobRecord[] = [];
  const seenIds = new Set<string>();
  let pagesFetched = 0;

  try {
    progress("Built In: fetching listings via HTTP…");
    for (let i = 0; i < searches.length; i += 1) {
      if (i > 0 && config.pageDelayMs > 0) await sleep(config.pageDelayMs);
      pagesFetched += await fetchOneBuiltinSearchHttp(
        searches[i]!,
        i + 1,
        searches.length,
        seenIds,
        jobs,
      );
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

/**
 * Wait for manual login without spamming checks.
 * Pattern: wait N seconds → check once → repeat up to M attempts.
 */
async function waitForBuiltinLogin(page: Page, listingUrl: string): Promise<boolean> {
  const waitMs = Math.max(1_000, config.builtinLoginWaitMs);
  const attempts = Math.max(1, config.builtinLoginAttempts);
  const waitSec = Math.round(waitMs / 1000);

  progress(
    `  Built In requires login — sign in in the OPEN browser window (do not close it).`,
  );
  progress(
    `  Will wait ${waitSec}s then check, up to ${attempts} time(s). No reloads of this tab while you sign in.`,
  );

  try {
    const loginUrl = "https://builtin.com/auth/login";
    if (!/auth\/login|join|signin/i.test(page.url())) {
      await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    }
  } catch {
    // stay on current page
  }

  const context = page.context();

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    progress(`  Built In login: waiting ${waitSec}s (attempt ${attempt}/${attempts})…`);
    await sleep(waitMs);

    let checker: Page | null = null;
    try {
      progress(`  Built In login: checking (attempt ${attempt}/${attempts})…`);
      checker = await context.newPage();
      await checker.goto(listingUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await sleep(800);
      const init = parseJobPostInit(await checker.content());
      if (init?.isLoggedIn) {
        progress("  Built In: login detected (isLoggedIn=true)");
        return true;
      }
      if (attempt < attempts) {
        progress(`  Built In: not logged in yet — waiting another ${waitSec}s…`);
      }
    } catch (err) {
      progress(
        `  Built In login check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (checker) await checker.close().catch(() => undefined);
    }
  }

  progress(`  Built In: login not detected after ${attempts} attempt(s)`);
  return false;
}

async function followApplyRedirect(page: Page, redirectUrl: string): Promise<string> {
  const context = page.context();
  const popupPromise = context.waitForEvent("page", { timeout: 6_000 }).catch(() => null);
  await page.goto(redirectUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
    await sleep(600);
    const url = popup.url();
    await popup.close().catch(() => undefined);
    return url;
  }
  await sleep(800);
  return page.url();
}

async function resolveEmployerApplyUrl(
  page: Page,
  listingUrl: string,
  label: string,
  job: JobRecord,
): Promise<string | null> {
  progress(`  → ${label}`);
  await page.goto(listingUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await sleep(600);
  const html = await page.content();
  const init = parseJobPostInit(html);

  const employmentType = extractEmploymentTypeFromBuiltinHtml(html);
  if (employmentType) job.employmentType = employmentType;

  const redirect = extractApplyRedirectUrl(html);
  if (!redirect) {
    progress(`    · no applyUrl (${label})`);
    return null;
  }

  if (!isBuiltinHost(redirect)) return redirect;

  let finalUrl = await followApplyRedirect(page, redirect);

  if (/applyRequired=true/i.test(finalUrl)) {
    progress(
      `    · applyRequired (loggedIn=${Boolean(init?.isLoggedIn)}) — need login before parallel resolve`,
    );
    return null;
  }

  if (!finalUrl || isBuiltinHost(finalUrl)) {
    progress(`    · no external URL (${finalUrl})`);
    return null;
  }

  return finalUrl;
}

/** Ensure session is logged in once before parallel apply workers. */
async function ensureBuiltinLoggedIn(
  context: BrowserContext,
  sampleListingUrl: string,
): Promise<boolean> {
  const page = await context.newPage();
  try {
    await page.goto(sampleListingUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await sleep(800);
    let init = parseJobPostInit(await page.content());
    if (init?.isLoggedIn) {
      progress("Built In: already logged in");
      return true;
    }

    const redirect = extractApplyRedirectUrl(await page.content());
    if (redirect && isBuiltinHost(redirect)) {
      const landed = await followApplyRedirect(page, redirect);
      if (/applyRequired=true/i.test(landed)) {
        const ok = await waitForBuiltinLogin(page, sampleListingUrl);
        if (!ok) return false;
      }
    } else {
      const ok = await waitForBuiltinLogin(page, sampleListingUrl);
      if (!ok) return false;
    }

    await page.goto(sampleListingUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await sleep(800);
    init = parseJobPostInit(await page.content());
    return Boolean(init?.isLoggedIn);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** True when jobLink is still a builtin.com listing (no employer URL resolved). */
export function isBuiltinListingLink(job: JobRecord): boolean {
  if (job.source !== "builtin") return false;
  try {
    return isBuiltinHost(job.jobLink);
  } catch {
    return true;
  }
}

/** Public listing pages include schema.org employmentType — no login required. */
async function enrichBuiltinEmploymentTypes(jobs: JobRecord[]): Promise<void> {
  const pending = jobs.filter((j) => j.listingUrl && !j.employmentType);
  if (pending.length === 0) return;

  progress(`Built In: reading employment type for ${pending.length} listing(s)…`);
  for (const job of pending) {
    try {
      const res = await httpGet(job.listingUrl!);
      if (!res.ok) continue;
      const type = extractEmploymentTypeFromBuiltinHtml(await res.text());
      if (type) job.employmentType = type;
    } catch {
      // best-effort
    }
    if (config.pageDelayMs > 0) await sleep(Math.min(config.pageDelayMs, 200));
  }
}

/**
 * Resolve employer apply URLs in a headed browser.
 * Listings are fetched via HTTP; browser is only for ApplyRedirect (+ manual login).
 * After login, resolves several jobs in parallel tabs.
 */
export async function enrichBuiltinApplyUrls(jobs: JobRecord[]): Promise<void> {
  const targets = jobs.filter((j) => Boolean(j.listingUrl));
  if (targets.length === 0) {
    await closeBuiltinBrowser();
    return;
  }

  await enrichBuiltinEmploymentTypes(targets);

  const concurrency = Math.max(1, config.builtinApplyConcurrency);
  progress(
    `Built In: resolving apply URLs for ${targets.length} job(s) (headed browser, concurrency=${concurrency})…`,
  );

  try {
    const context = await ensureBrowserContext();
    const sampleUrl = targets[0]!.listingUrl!;
    const loggedIn = await ensureBuiltinLoggedIn(context, sampleUrl);
    if (!loggedIn) {
      progress("Built In: login failed/timed out — no employer URLs will be resolved");
      return;
    }

    let done = 0;
    let resolved = 0;

    for (let i = 0; i < targets.length; i += concurrency) {
      const batch = targets.slice(i, i + concurrency);
      const pages = await Promise.all(batch.map(() => context.newPage()));

      await Promise.all(
        batch.map(async (job, idx) => {
          const page = pages[idx]!;
          const label = `${job.company} — ${job.title}`;
          try {
            const apply = await resolveEmployerApplyUrl(page, job.listingUrl!, label, job);
            if (apply) {
              job.jobLink = apply;
              resolved += 1;
              progress(`    ✓ ${label}: ${apply}`);
            }
          } catch (err) {
            progress(
              `    · failed ${label}: ${err instanceof Error ? err.message : String(err)}`,
            );
          } finally {
            await page.close().catch(() => undefined);
          }
        }),
      );

      done += batch.length;
      progress(`  Built In apply URLs: ${done}/${targets.length} (${resolved} resolved)`);
      if (i + concurrency < targets.length && config.pageDelayMs > 0) {
        await sleep(Math.min(config.pageDelayMs, 300));
      }
    }
  } finally {
    await closeBuiltinBrowser();
  }
}

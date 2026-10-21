const MAX_PAGES = 30;
const ATS_HOST =
  /dayforcehcm\.com|greenhouse\.io|ashbyhq\.com|smartrecruiters\.com|bamboohr\.com|myworkdayjobs\.com|workday\.com|hirebridge\.com|oraclecloud\.com|lever\.co|rippling\.com|icims\.com|adp\.com|zohorecruit\.com|gem\.com|workable\.com|jobvite\.com|ultipro\.com|successfactors\.com|taleo\.net|paylocity\.com|breezy\.hr|recruitee\.com|comeet\.co|csod\.com/i;

let current = null;
let lastProgress = "";
let lastLog = [];

function report(text) {
  const log = current?.log ?? lastLog;
  log.push(text);
  if (log.length > 500) log.shift();
  lastLog = log;
  lastProgress = text;
  chrome.runtime.sendMessage({ type: "progress", text, log: log.slice() }).catch(() => {});
}

class Stopped extends Error {
  constructor() {
    super("Stopped");
    this.stopped = true;
  }
}

function beginRun() {
  current = { cancelled: false, extraTabs: new Set(), waiters: new Set(), log: [] };
  lastLog = current.log;
  return current;
}

function endRun(run) {
  if (current !== run) return;
  current = null;
  chrome.runtime.sendMessage({ type: "idle" }).catch(() => {});
}

function checkStop() {
  if (current?.cancelled) throw new Stopped();
}

function stopRun() {
  if (!current || current.cancelled) return;
  current.cancelled = true;
  for (const cancel of current.waiters) cancel();
  current.waiters.clear();
  for (const tabId of current.extraTabs) {
    chrome.tabs.remove(tabId).catch(() => {});
  }
  current.extraTabs.clear();
  current.upload?.abort();
  report("Stopped. Nothing was uploaded.");
}

function trackWait(cancel) {
  current?.waiters.add(cancel);
  return () => current?.waiters.delete(cancel);
}

function isBuiltinHost(url) {
  try {
    return /(^|\.)builtin\.com$/i.test(new URL(url).hostname);
  } catch {
    return /builtin\.com/i.test(url || "");
  }
}

function isHiringCafeHost(url) {
  try {
    return /(^|\.)hiringcafe\.com$/i.test(new URL(url).hostname);
  } catch {
    return /hiringcafe\.com/i.test(url || "");
  }
}

function isExternal(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return !isBuiltinHost(url);
  } catch {
    return false;
  }
}

function sleep(ms) {
  checkStop();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, ms);
    const untrack = trackWait(cancel);
    function finish() {
      untrack();
      resolve();
    }
    function cancel() {
      clearTimeout(timer);
      untrack();
      reject(new Stopped());
    }
  });
}

function waitForTab(tabId, timeoutMs = 45000) {
  checkStop();
  return new Promise((resolve, reject) => {
    let settled = false;
    const untrack = trackWait(cancel);
    const timer = setTimeout(() => {
      settle(() => reject(new Error("Timed out waiting for the page")));
    }, timeoutMs);
    function settle(done) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      untrack();
      done();
    }
    function cancel() {
      settle(() => reject(new Stopped()));
    }
    const onUpdated = (id, info) => {
      if (id !== tabId || info.status !== "complete") return;
      settle(resolve);
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") settle(resolve);
    }).catch(() => {});
  });
}

async function send(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["collect.js"] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function postJson(server, token, path, body) {
  checkStop();
  const upload = new AbortController();
  if (current) current.upload = upload;
  const response = await fetch(`${server}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token || ""}`,
    },
    body: JSON.stringify(body),
    signal: upload.signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && !payload.error) payload.error = `Server responded ${response.status}`;
  return payload;
}

function normalizeKeyPart(value) {
  return (value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function jobKey(job) {
  const company = normalizeKeyPart(job.company);
  const title = normalizeKeyPart(job.title);
  if (job.source === "dice") return `${company}|${title}`;
  return `${company}|${title}|${job.jobLink}`;
}

function labelEmployment(raw) {
  const key = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!key) return "";
  if (/full\s*time/.test(key) || key === "fulltime") return "Full-time";
  if (/part\s*time/.test(key) || key === "parttime") return "Part-time";
  if (/contract|contractor|freelance/.test(key)) return "Contract";
  if (/temp(orary)?/.test(key)) return "Temporary";
  if (/intern/.test(key)) return "Internship";
  if (/seasonal/.test(key)) return "Seasonal";
  return "";
}

function isLinkedInJobUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "linkedin.com" || host.endsWith(".linkedin.com");
  } catch {
    return /linkedin\.com/i.test(url || "");
  }
}

function jobrightFromApi(raw) {
  const jr = raw?.jobResult || {};
  const company = String(raw?.companyResult?.companyName || "").trim();
  const title = String(jr.jobTitle || "").trim();
  const jobId = String(jr.jobId || "").trim();
  const applyLink = String(jr.applyLink || "").trim();
  if (!title || !company) return null;
  if (applyLink && isLinkedInJobUrl(applyLink)) return null;
  const listingUrl = jobId ? `https://jobright.ai/jobs/info/${jobId}` : "";
  const jobLink = applyLink || listingUrl;
  if (!jobLink) return null;
  const employmentType = labelEmployment(jr.employmentType);
  return {
    company,
    title,
    jobLink,
    ...(listingUrl ? { listingUrl } : {}),
    source: "jobright",
    ...(jobId ? { externalId: jobId } : {}),
    ...(employmentType ? { employmentType } : {}),
  };
}

async function jobrightSessionId() {
  const cookies = await chrome.cookies.getAll({ domain: "jobright.ai", name: "SESSION_ID" });
  return cookies.find((cookie) => cookie.value)?.value || "";
}

async function fetchJobrightRecommendPage(position, refresh) {
  const url = new URL("https://swan-api.jobright.ai/swan/recommend/list/jobs");
  url.searchParams.set("position", String(position));
  url.searchParams.set("count", "20");
  if (refresh) url.searchParams.set("refresh", "true");
  const response = await fetch(url.href, { credentials: "include" });
  if (response.status === 401 || response.status === 403) {
    return { error: "JobRight session expired. Sign in on jobright.ai and try again.", jobs: [] };
  }
  if (!response.ok) return { error: `JobRight HTTP ${response.status}`, jobs: [] };
  const data = await response.json().catch(() => ({}));
  if (!data?.success) return { error: data?.message || "JobRight API error", jobs: [] };
  const jobs = (data.result?.jobList || []).map(jobrightFromApi).filter(Boolean);
  return { jobs };
}

async function collectJobright() {
  const sessionId = await jobrightSessionId();
  if (!sessionId) {
    throw new Error("Sign in to JobRight in this browser, then collect again.");
  }
  const hadApiCookie = await chrome.cookies.get({
    url: "https://swan-api.jobright.ai/",
    name: "SESSION_ID",
  });
  if (!hadApiCookie) {
    await chrome.cookies.set({
      url: "https://swan-api.jobright.ai/",
      name: "SESSION_ID",
      value: sessionId,
      secure: true,
      path: "/",
    });
  }

  const jobs = [];
  const seen = new Set();
  const pageSize = 20;
  const wanted = 100;
  const maxPages = 7;
  let position = 0;
  let pages = 0;
  let emptyPages = 0;

  try {
    while (jobs.length < wanted && pages < maxPages) {
      checkStop();
      if (position > 0) {
        report("Waiting for the next JobRight page…");
        await sleep(7000);
      }
      report(`Reading JobRight page ${pages + 1}…`);
      const result = await fetchJobrightRecommendPage(position, position === 0);
      if (result.error) {
        if (pages === 0) throw new Error(result.error);
        report(result.error);
        break;
      }
      const pageJobs = result.jobs || [];
      pages += 1;
      if (pageJobs.length === 0) {
        emptyPages += 1;
        if (emptyPages >= 2) break;
        position += pageSize;
        continue;
      }
      emptyPages = 0;
      let added = 0;
      for (const job of pageJobs) {
        const key = job.externalId || job.jobLink;
        if (seen.has(key)) continue;
        seen.add(key);
        jobs.push(job);
        added += 1;
      }
      report(`JobRight page ${pages} — ${jobs.length} job(s)`);
      if (added === 0) break;
      position += pageSize;
    }
    return { jobs, pages };
  } finally {
    if (!hadApiCookie) {
      await chrome.cookies.remove({ url: "https://swan-api.jobright.ai/", name: "SESSION_ID" });
    }
  }
}

async function collectSearch(tabId) {
  const tabUrl = (await chrome.tabs.get(tabId)).url || "";
  if (/jobright\.ai/i.test(tabUrl)) return collectJobright();

  const jobs = [];
  const seen = new Set();
  const seenUrls = new Set();
  let pages = 0;

  while (pages < MAX_PAGES) {
    checkStop();
    await waitForTab(tabId).catch((err) => {
      if (err?.stopped) throw err;
    });
    checkStop();
    let scraped = await send(tabId, { type: "scrape" });
    if ((scraped?.jobs || []).length === 0 && pages === 0) {
      await sleep(1500);
      scraped = await send(tabId, { type: "scrape" });
    }
    if (scraped?.unsupported) {
      throw new Error("This tab is not Hiring Cafe, Built In, JobRight, Dice, or Indeed.");
    }
    const pageJobs = scraped?.jobs || [];
    if (pageJobs.length === 0) break;

    let added = 0;
    let sameRole = 0;
    for (const job of pageJobs) {
      const key = jobKey(job);
      if (seen.has(key)) {
        if (job.source === "dice") sameRole += 1;
        continue;
      }
      seen.add(key);
      jobs.push(job);
      added += 1;
    }
    pages += 1;
    report(
      `Read page ${pages} — ${pageJobs.length} job(s) on this page, ${jobs.length} total${
        sameRole ? `, ${sameRole} same company and role skipped` : ""
      }`,
    );
    for (const line of scraped?.log || []) report(line);
    if (added === 0) break;

    const pageUrl = (await chrome.tabs.get(tabId)).url || "";
    seenUrls.add(pageUrl);

    checkStop();
    if (scraped.nextUrl && !seenUrls.has(scraped.nextUrl)) {
      await chrome.tabs.update(tabId, { url: scraped.nextUrl });
      await waitForTab(tabId);
      continue;
    }
    if (!scraped.hasNext) break;

    await send(tabId, { type: "clickNext" }).catch((err) => {
      if (err?.stopped) throw err;
    });
    await sleep(1200);
    await waitForTab(tabId).catch((err) => {
      if (err?.stopped) throw err;
    });
  }

  return { jobs, pages };
}

function readApplyFromPage() {
  const html = document.documentElement?.innerHTML || "";
  const init = html.match(/Builtin\.jobPostInit\((\{.*?\})\)\s*;/s);
  let applyUrl = "";
  if (init?.[1]) {
    try {
      const payload = JSON.parse(init[1]);
      applyUrl = payload?.job?.howToApply || payload?.job?.applyUrl || "";
    } catch {
      applyUrl = "";
    }
  }
  if (!applyUrl) {
    const m = html.match(/"applyUrl"\s*:\s*"((?:\\.|[^"\\])*)"/);
    applyUrl = m?.[1]?.replace(/\\\//g, "/") || "";
  }
  if (applyUrl && applyUrl.startsWith("/")) applyUrl = `https://builtin.com${applyUrl}`;
  const ats = html.match(
    /https?:\/\/[^"'\\\s<>]*(?:dayforcehcm\.com|greenhouse\.io|ashbyhq\.com|smartrecruiters\.com|bamboohr\.com|myworkdayjobs\.com|workday\.com|lever\.co|icims\.com|adp\.com|workable\.com|oraclecloud\.com)[^"'\\\s<>]*/i,
  );
  const types = [];
  const labelEmployment = (raw) => {
    const key = String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");
    if (!key) return "";
    if (/full\s*time/.test(key) || key === "fulltime") return "Full-time";
    if (/part\s*time/.test(key) || key === "parttime") return "Part-time";
    if (/contract|contractor|freelance/.test(key)) return "Contract";
    if (/temp(orary)?/.test(key)) return "Temporary";
    if (/intern/.test(key)) return "Internship";
    if (/seasonal/.test(key)) return "Seasonal";
    return "";
  };
  for (const match of html.matchAll(/"employmentType"\s*:\s*"([^"]+)"/g)) {
    const label = labelEmployment(match[1]);
    if (label && !types.includes(label)) types.push(label);
  }
  return {
    applyUrl,
    ats: ats?.[0]?.replace(/\\\//g, "/").replace(/&amp;/g, "&") || "",
    employmentType: types.join(", "),
  };
}

function waitForExternalUrl(tabId, timeoutMs, accept = isExternal) {
  checkStop();
  return new Promise((resolve, reject) => {
    let settled = false;
    const untrack = trackWait(() => finish(null, true));
    const timer = setTimeout(() => finish(null, false), timeoutMs);
    const finish = (url, stopped) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onCreated.removeListener(onCreated);
      untrack();
      if (stopped) reject(new Stopped());
      else resolve(url);
    };
    const consider = (url) => {
      if (url && accept(url)) finish(url);
    };
    const onUpdated = (id, _info, tab) => {
      if (id === tabId) consider(tab.url);
    };
    const onCreated = (tab) => {
      if (tab.openerTabId !== tabId) return;
      const childId = tab.id;
      const onChild = (id, _info, child) => {
        if (id !== childId) return;
        if (child.url && accept(child.url)) {
          chrome.tabs.onUpdated.removeListener(onChild);
          chrome.tabs.remove(childId).catch(() => {});
          finish(child.url);
        }
      };
      chrome.tabs.onUpdated.addListener(onChild);
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onCreated.addListener(onCreated);
  });
}

async function resolveBuiltinJob(job) {
  const listing = job.listingUrl || job.jobLink;
  if (!listing || !isBuiltinHost(listing)) return job.jobLink;
  checkStop();
  const tab = await chrome.tabs.create({ url: listing, active: false });
  if (tab.id != null) current?.extraTabs.add(tab.id);
  try {
    checkStop();
    await waitForTab(tab.id);
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readApplyFromPage,
    });
    const found = injected?.result || {};
    if (found.employmentType) job.employmentType = found.employmentType;
    if (found.ats && isExternal(found.ats) && ATS_HOST.test(found.ats)) return found.ats;
    if (found.applyUrl && isExternal(found.applyUrl)) return found.applyUrl;

    const watch = waitForExternalUrl(tab.id, 12000);
    if (found.applyUrl && isBuiltinHost(found.applyUrl)) {
      await chrome.tabs.update(tab.id, { url: found.applyUrl });
    } else {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.querySelector("a[href*='handler=ApplyRedirect']")?.click(),
      });
    }
    const landed = await watch;
    if (landed) return landed;

    const [again] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readApplyFromPage,
    });
    const second = again?.result || {};
    if (second.ats && isExternal(second.ats)) return second.ats;
    const finalUrl = (await chrome.tabs.get(tab.id)).url || "";
    return isExternal(finalUrl) ? finalUrl : job.jobLink;
  } finally {
    if (tab.id != null) {
      current?.extraTabs.delete(tab.id);
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

function readHiringCafeApply() {
  const html = document.documentElement?.innerHTML || "";
  const raw = html.match(/"apply_url"\s*:\s*"((?:\\.|[^"\\])*)"/);
  const applyUrl = raw?.[1]?.replace(/\\\//g, "/").replace(/\\u0026/g, "&") || "";
  const link = [...document.querySelectorAll("a")].find((anchor) =>
    /apply directly/i.test(anchor.innerText || ""),
  );
  return { applyUrl, href: link?.href || "" };
}

function isEmployerUrl(url) {
  return isExternal(url) && !isHiringCafeHost(url);
}

async function resolveHiringCafeJob(job) {
  const listing = job.listingUrl || job.jobLink;
  if (!listing || !isHiringCafeHost(listing)) return job.jobLink;
  checkStop();
  const tab = await chrome.tabs.create({ url: listing, active: false });
  if (tab.id != null) current?.extraTabs.add(tab.id);
  try {
    checkStop();
    await waitForTab(tab.id);
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readHiringCafeApply,
    });
    const found = injected?.result || {};
    if (isEmployerUrl(found.applyUrl)) return found.applyUrl;
    if (isEmployerUrl(found.href)) return found.href;

    const watch = waitForExternalUrl(tab.id, 12000, isEmployerUrl);
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const control = [...document.querySelectorAll("a, button")].find((node) =>
          /apply directly/i.test(node.innerText || ""),
        );
        control?.click();
      },
    });
    const landed = await watch;
    if (isEmployerUrl(landed)) return landed;
    const finalUrl = (await chrome.tabs.get(tab.id)).url || "";
    return isEmployerUrl(finalUrl) ? finalUrl : job.jobLink;
  } finally {
    if (tab.id != null) {
      current?.extraTabs.delete(tab.id);
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

async function resolveHiringCafeJobs(jobs) {
  const pending = jobs.filter((job) => job.source === "hiringcafe" && isHiringCafeHost(job.jobLink));
  let done = 0;
  const concurrency = 3;
  for (let i = 0; i < pending.length; i += concurrency) {
    checkStop();
    const batch = pending.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (job) => {
        let linked = false;
        try {
          const apply = await resolveHiringCafeJob(job);
          if (isEmployerUrl(apply)) {
            job.jobLink = apply;
            linked = true;
          }
        } catch (err) {
          if (err?.stopped) throw err;
        }
        done += 1;
        report(
          `Employer link ${done}/${pending.length} ${linked ? "linked" : "no employer link"} — ${job.company} — ${job.title}`,
        );
      }),
    );
  }
}

async function resolveBuiltinJobs(jobs) {
  const pending = jobs.filter((job) => job.source === "builtin" && isBuiltinHost(job.jobLink));
  let done = 0;
  const concurrency = 3;
  for (let i = 0; i < pending.length; i += concurrency) {
    checkStop();
    const batch = pending.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (job) => {
        let linked = false;
        try {
          const apply = await resolveBuiltinJob(job);
          if (apply && isExternal(apply)) {
            job.jobLink = apply;
            linked = true;
          }
        } catch (err) {
          if (err?.stopped) throw err;
        }
        done += 1;
        report(
          `Apply ${done}/${pending.length} ${linked ? "linked" : "no employer link"} — ${job.company} — ${job.title}`,
        );
      }),
    );
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "status") {
    sendResponse({
      running: Boolean(current && !current.cancelled),
      text: lastProgress,
      log: (current?.log ?? lastLog).slice(),
    });
    return;
  }
  if (message?.type === "stop") {
    stopRun();
    sendResponse({ ok: true });
    return;
  }
  if (message?.type !== "collect") return;
  if (current && !current.cancelled) {
    sendResponse({ ok: false, error: "Already collecting. Press Stop first." });
    return;
  }
  const run = beginRun();
  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      sendResponse({ ok: false, error: "No active tab." });
      return;
    }
    report("Reading this search…");
    const { jobs, pages } = await collectSearch(tab.id);
    checkStop();
    const server = (message.server || "http://127.0.0.1:3921").replace(/\/$/, "");
    report(`Checking duplicates and titles for ${jobs.length} job(s)…`);
    const prepared = await postJson(server, message.token, "/prepare", {
      profile: message.profile,
      jobs,
    });
    if (!prepared.ok) {
      report(prepared.error || "Duplicate check failed.");
      sendResponse({ ...prepared, pages, ok: false });
      return;
    }
    const keepers = prepared.jobs || [];
    report(`Title filter (manager, director, VP, …) skipped ${prepared.skippedByTitle || 0}`);
    report(`Duplicate in this search skipped ${prepared.skippedWithinRun || 0}`);
    report(`Local company skipped ${prepared.skippedByCv || 0}`);
    report(`Peer company+role skipped ${prepared.skippedByPeerRole || 0}`);
    report(`Already on sheet skipped ${prepared.skippedDuplicates || 0}`);
    report(`${keepers.length} job(s) left after checks`);
    checkStop();
    const needBuiltin = keepers.filter((job) => job.source === "builtin" && isBuiltinHost(job.jobLink));
    if (needBuiltin.length > 0) {
      report(`Opening apply links for ${needBuiltin.length} Built In job(s)…`);
      await resolveBuiltinJobs(needBuiltin);
    }
    checkStop();
    const needHiringCafe = keepers.filter(
      (job) => job.source === "hiringcafe" && isHiringCafeHost(job.jobLink),
    );
    if (needHiringCafe.length > 0) {
      report(`Opening employer links for ${needHiringCafe.length} Hiring Cafe job(s)…`);
      await resolveHiringCafeJobs(needHiringCafe);
    }
    checkStop();
    report(`Uploading ${keepers.length} job(s)…`);
    const uploaded = await postJson(server, message.token, "/upload", {
      profile: message.profile,
      jobs: keepers,
    });
    if (!uploaded.ok) report(uploaded.error || "Upload failed.");
    if (uploaded.skippedBuiltinListing) {
      report(`Built In without employer URL skipped ${uploaded.skippedBuiltinListing}`);
    }
    report(`Same job link on Clinton, Nathan, or Blake skipped ${uploaded.skippedByPeerSheet || 0}`);
    report(`Uploaded ${uploaded.appended || 0} to ${message.profile}.`);
    sendResponse({
      ...prepared,
      ...uploaded,
      pages,
      ok: Boolean(uploaded.ok),
    });
  })().catch((err) => {
    if (err?.stopped || err?.name === "AbortError") {
      sendResponse({ ok: false, stopped: true, error: "Stopped. Nothing was uploaded." });
      return;
    }
    sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }).finally(() => endRun(run));
  return true;
});

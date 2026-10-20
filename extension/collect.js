if (!globalThis.__jobFetcherCollect) {
  globalThis.__jobFetcherCollect = true;

  function clean(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function absolute(href) {
    if (!href) return "";
    try {
      return new URL(href, location.href).href;
    } catch {
      return "";
    }
  }

  function pushJob(out, seen, job) {
    const company = clean(job.company);
    const title = clean(job.title);
    const jobLink = absolute(job.jobLink);
    if (!company || !title || !jobLink) return;
    if (/^(apply|save|share|view|jobs|companies|remote|salaries|sign in|log in|next|previous)$/i.test(title)) {
      return;
    }
    const key = `${company.toLowerCase()}|${title.toLowerCase()}|${jobLink}`;
    if (seen.has(key)) return;
    seen.add(key);
    const listingUrl = absolute(job.listingUrl || job.jobLink);
    out.push({
      company,
      title,
      jobLink,
      ...(listingUrl ? { listingUrl } : {}),
      source: job.source,
      ...(job.externalId ? { externalId: String(job.externalId) } : {}),
      ...(clean(job.employmentType) ? { employmentType: clean(job.employmentType) } : {}),
    });
  }

  function findNext() {
    const selectors = [
      "a[rel='next']",
      "a[aria-label='Next' i]",
      "a[aria-label='Next Page' i]",
      "a[aria-label*='next page' i]",
      "a[data-testid='pagination-page-next']",
      "a[data-testid='pagination-next']",
      "button[aria-label='Next' i]",
      "button[aria-label='Next Page' i]",
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const href = el.getAttribute("href");
      if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
        const url = absolute(href);
        if (url && url !== location.href) return { nextUrl: url };
      }
      return { hasNext: true };
    }
    return {};
  }

  function findBuiltinNext() {
    const current = Number(new URL(location.href).searchParams.get("page") || "1");
    const wanted = current + 1;
    const link = document.querySelector(`a[aria-label="Go to page ${wanted}" i], a[aria-label="Go to Page ${wanted}"]`);
    if (link?.getAttribute("href")) {
      const url = absolute(link.getAttribute("href"));
      if (url && url !== location.href) return { nextUrl: url };
    }
    return findNext();
  }

  function labelEmployment(raw) {
    const key = clean(raw).toLowerCase().replace(/[_-]+/g, " ");
    if (!key) return "";
    if (/full\s*time/.test(key) || key === "fulltime") return "Full-time";
    if (/part\s*time/.test(key) || key === "parttime") return "Part-time";
    if (/contract|contractor|freelance/.test(key)) return "Contract";
    if (/temp(orary)?/.test(key)) return "Temporary";
    if (/intern/.test(key)) return "Internship";
    if (/seasonal/.test(key)) return "Seasonal";
    return "";
  }

  function employmentTypeFromCard(card) {
    if (!card) return "";
    if (clean(card.innerText).length > 700) return "";
    const hits = [];
    for (const line of (card.innerText || "").split(/\n/).map(clean)) {
      if (!line || line.length > 24) continue;
      const label = labelEmployment(line);
      if (label && !hits.includes(label)) hits.push(label);
    }
    return hits.join(", ");
  }

  function isTimeAgo(text) {
    return (
      /^\d+\s*[mhdw]$/i.test(text) ||
      /^\d+\s*(min|mins|hr|hrs|hour|hours|day|days|week|weeks|mo|month|months)s?$/i.test(text) ||
      /^(just now|today|yesterday)$/i.test(text)
    );
  }

  function hiringCafeChromeLine(line) {
    if (!line) return true;
    if (/job posting/i.test(line)) return true;
    if (/^(view all|see all)$/i.test(line)) return true;
    if (/^\d+$/.test(line)) return true;
    if (/offers\s*·\s*interviews/i.test(line)) return true;
    if (isTimeAgo(line)) return true;
    if (line.length <= 24 && labelEmployment(line)) return true;
    return /^(remote|hybrid|onsite|on-site|apply|save|new)$/i.test(line);
  }

  function hiringCafeChromeText(text) {
    const lines = String(text || "").split(/\n/).map(clean).filter(Boolean);
    return lines.length === 0 || lines.every(hiringCafeChromeLine);
  }

  function hiringCafeCard(anchor) {
    let node = anchor;
    let fallback = anchor.parentElement || anchor;
    for (let i = 0; i < 10 && node?.parentElement; i += 1) {
      node = node.parentElement;
      const hrefs = new Set(
        [...node.querySelectorAll('a[href*="/job/"]')].map((a) => (a.getAttribute("href") || "").split("?")[0]),
      );
      if (hrefs.size !== 1) break;
      fallback = node;
      const text = node.innerText || "";
      if (!hiringCafeChromeText(text) && clean(text).length > 30 && clean(text).length < 1200) return node;
    }
    return fallback;
  }

  function clip(text, max = 180) {
    const value = clean(text);
    return value.length > max ? `${value.slice(0, max)}…` : value;
  }

  function hiringCafeTitle(card, anchor) {
    const labelled = clean(anchor.getAttribute("aria-label") || anchor.getAttribute("title") || "");
    if (labelled && !/job posting/i.test(labelled) && labelled.length > 2 && labelled.length < 180) {
      return { title: labelled, via: `link label "${labelled}"` };
    }
    for (const node of card.querySelectorAll("h1, h2, h3, h4, [class*='title' i]")) {
      const text = clean(node.innerText);
      if (!text || text.length < 3 || text.length > 180) continue;
      if (hiringCafeChromeLine(text)) continue;
      return { title: text, via: `heading "${text}"` };
    }
    const lines = (card.innerText || "")
      .split(/\n/)
      .map(clean)
      .filter((line) => line.length >= 8 && line.length <= 160);
    const line = lines.find((item) => !hiringCafeChromeLine(item)) || "";
    return { title: line, via: line ? `card line "${line}"` : "no title" };
  }

  function hiringCafePlaceLine(line) {
    if (!line || line.includes(":")) return false;
    if (/\+\d+\s+more$/i.test(line)) return true;
    if (/\b(united states|u\.s\.a?\.?|canada|europe)\b/i.test(line)) return true;
    if (/,/.test(line) && line.length < 100) return true;
    if (/\bor\b/i.test(line) && line.length < 100) return true;
    return false;
  }

  function hiringCafeSalaryLine(line) {
    return /\$\s?\d/.test(line) || /\/yr\b/i.test(line) || /\bYOE\b/i.test(line);
  }

  function hiringCafeCompanyName(line) {
    const colon = line.indexOf(":");
    if (colon < 2) return "";
    const name = line
      .slice(0, colon)
      .replace(
        /(?:NASDAQ|NYSE|Nasdaq|AMEX|TSX|LSE|ASX)(?:\s*,\s*(?:NASDAQ|NYSE|Nasdaq|AMEX|TSX|LSE|ASX))*(?:\s+Global(?:\s+Select)?\s+Market)?$/i,
        "",
      )
      .trim();
    if (!name || name.length > 80 || hiringCafeChromeLine(name) || hiringCafePlaceLine(name)) return "";
    return name;
  }

  function hiringCafeCompany(card, title) {
    const lines = (card.innerText || "").split(/\n/).map(clean).filter(Boolean);
    const blurb = lines.find((item) => item !== title && hiringCafeCompanyName(item));
    if (blurb) {
      const name = hiringCafeCompanyName(blurb);
      return { company: name, via: `company line "${name}"` };
    }
    const line =
      lines.find(
        (item) =>
          item !== title &&
          item.length > 1 &&
          item.length < 80 &&
          !hiringCafeChromeLine(item) &&
          !hiringCafePlaceLine(item) &&
          !hiringCafeSalaryLine(item),
      ) || "";
    return { company: line, via: line ? `other card line "${line}"` : "no company" };
  }

  function hiringCafeLooksWrong(company, title) {
    return (
      hiringCafeChromeLine(title) ||
      hiringCafeChromeLine(company) ||
      hiringCafePlaceLine(company) ||
      hiringCafeSalaryLine(company)
    );
  }

  function jobsFromHiringCafeData() {
    const raw = document.querySelector("#__NEXT_DATA__")?.textContent;
    if (!raw) return [];
    let hits = [];
    try {
      hits = JSON.parse(raw)?.props?.pageProps?.ssrHits || [];
    } catch {
      return [];
    }
    if (!Array.isArray(hits) || hits.length === 0) return [];
    const slugs = new Map();
    document.querySelectorAll('a[href*="/job/"]').forEach((anchor) => {
      const href = anchor.getAttribute("href") || "";
      const suffix = href.split("?")[0].split("-").pop();
      if (suffix) slugs.set(suffix, href);
    });
    const jobs = [];
    const seen = new Set();
    for (const hit of hits) {
      const info = hit?.job_information || {};
      const processed = hit?.v5_processed_job_data || {};
      const title = clean(info.title || info.job_title_raw || processed.core_job_title);
      const company = clean(processed.company_name || hit?.enriched_company_data?.name);
      const req = clean(hit?.requisition_id);
      const listing = (req && slugs.get(req)) || "";
      const apply = clean(hit?.apply_url);
      const typeRaw = processed.commitment || processed.employment_types;
      const parts = Array.isArray(typeRaw) ? typeRaw : String(typeRaw || "").split(/[,|/]/);
      const types = [];
      for (const part of parts) {
        const label = labelEmployment(part);
        if (label && !types.includes(label)) types.push(label);
      }
      pushJob(jobs, seen, {
        company,
        title,
        jobLink: apply || listing,
        listingUrl: listing || apply,
        source: "hiringcafe",
        externalId: hit?.id || hit?.objectID || req,
        employmentType: types.join(", "),
      });
    }
    return jobs;
  }

  function companyNear(el) {
    const card =
      el?.closest("article, li, tr, [id^='job-card-'], [class*='card'], [class*='job']") ||
      el?.parentElement;
    if (!card) return "";
    const named = card.querySelector(
      "[data-testid='company-name'], [data-cy='search-result-company-name'], [data-id='company-title'] span, [data-id='company-title'], .companyName",
    );
    const text = clean(named?.innerText);
    if (text && text.length < 120) return text;
    const title = clean(el?.innerText);
    const lines = (card.innerText || "")
      .split(/\n/)
      .map(clean)
      .filter((line) => line && line.length < 80 && line !== title);
    return (
      lines.find(
        (line) =>
          !isTimeAgo(line) &&
          !/^(apply|save|easy apply|full[- ]time|contract|remote|hybrid|job posting)$/i.test(line),
      ) ||
      ""
    );
  }

  function scrapeIndeed() {
    const jobs = [];
    const seen = new Set();
    const cards = document.querySelectorAll(".job_seen_beacon, .cardOutline, td.resultContent, [data-jk]");
    cards.forEach((card) => {
      const titleA = card.querySelector("h2 a, a.jcs-JobTitle, a[id^='sj_']");
      const jk = card.getAttribute("data-jk") || card.querySelector("[data-jk]")?.getAttribute("data-jk") || "";
      const href = titleA?.getAttribute("href") || (jk ? `/viewjob?jk=${jk}` : "");
      pushJob(jobs, seen, {
        company: companyNear(titleA || card) || card.querySelector("[data-testid='company-name'], .companyName")?.innerText,
        title: titleA?.innerText || card.querySelector("h2")?.innerText,
        jobLink: href,
        source: "indeed",
        externalId: jk,
        employmentType: employmentTypeFromCard(card),
      });
    });
    return { jobs, ...findNext() };
  }

  function diceTypePart(part) {
    if (/^third\s*party$/i.test(part)) return "Third Party";
    return labelEmployment(part);
  }

  function diceEmployment(root) {
    const node = root?.querySelector?.(
      "[aria-labelledby='employmentType-label'] p, p[id='employmentType-label']",
    );
    const text = clean(node?.innerText || node?.textContent);
    if (!text) return "";
    const labels = text
      .split(/[,/|]/)
      .map(clean)
      .map(diceTypePart)
      .filter(Boolean);
    return [...new Set(labels)].join(", ");
  }

  function scrapeDice() {
    const jobs = [];
    const seen = new Set();
    const cards = document.querySelectorAll(
      "[data-testid='job-card'], [data-cy='search-card'], dhi-search-card, .search-card",
    );
    const readCard = (card) => {
      const root = card.shadowRoot || card;
      const titleA =
        root.querySelector("a[data-testid='job-search-job-detail-link'], a.card-title-link") ||
        [...root.querySelectorAll("a[href*='/job-detail/']")].find((anchor) => clean(anchor.innerText));
      if (!titleA) return;
      pushJob(jobs, seen, {
        company:
          root.querySelector(
            "[data-testid='job-card-company-name'], [data-cy='search-result-company-name'], a[href*='/company-profile/'] p",
          )?.innerText,
        title: titleA.innerText || titleA.getAttribute("aria-label"),
        jobLink: titleA.getAttribute("href"),
        source: "dice",
        externalId: card.getAttribute("data-job-guid") || titleA.getAttribute("id") || "",
        employmentType: diceEmployment(root),
      });
    };
    cards.forEach(readCard);
    if (jobs.length === 0) {
      document.querySelectorAll("a[data-testid='job-search-job-detail-link'], a[href*='/job-detail/']").forEach((titleA) => {
        if (!clean(titleA.innerText)) return;
        const card = titleA.closest("[data-testid='job-card'], article, li") || titleA.parentElement;
        pushJob(jobs, seen, {
          company: companyNear(titleA),
          title: titleA.innerText,
          jobLink: titleA.getAttribute("href"),
          source: "dice",
          employmentType: diceEmployment(card),
        });
      });
    }
    return { jobs, ...findDiceNext() };
  }

  function findDiceNext() {
    const url = new URL(location.href);
    if (!/\/jobs\/?$/i.test(url.pathname)) return {};
    const current = Number(url.searchParams.get("page") || "1");
    const next = Number.isFinite(current) && current >= 1 ? current + 1 : 2;
    url.searchParams.set("page", String(next));
    return { nextUrl: url.toString() };
  }

  function scrapeBuiltin() {
    const jobs = [];
    const seen = new Set();
    document.querySelectorAll("[id^='job-card-']").forEach((card) => {
      const titleA = card.querySelector("a[data-alias^='/job/'], a[href*='/job/']");
      const path = titleA?.getAttribute("data-alias") || titleA?.getAttribute("href") || "";
      pushJob(jobs, seen, {
        company: card.querySelector("[data-id='company-title'] span, [data-id='company-title']")?.innerText,
        title: titleA?.innerText,
        jobLink: path,
        listingUrl: path,
        source: "builtin",
        externalId: card.id.replace(/^job-card-/, ""),
        employmentType: employmentTypeFromCard(card),
      });
    });
    return { jobs, ...findBuiltinNext() };
  }

  function scrapeHiringCafeDom() {
    const jobs = [];
    const seen = new Set();
    const seenHrefs = new Set();
    const rows = [];
    document.querySelectorAll('a[href*="/job/"]').forEach((anchor) => {
      const href = (anchor.getAttribute("href") || "").split("?")[0];
      if (!href || seenHrefs.has(href)) return;
      seenHrefs.add(href);
      const card = hiringCafeCard(anchor);
      const { title, via: titleVia } = hiringCafeTitle(card, anchor);
      const { company, via: companyVia } = hiringCafeCompany(card, title);
      const row = {
        href,
        anchorText: clean(anchor.innerText),
        title,
        titleVia,
        company,
        companyVia,
        card: clip(card?.innerText),
        kept: false,
      };
      if (!title || !company || hiringCafeLooksWrong(company, title)) {
        row.skipped = !title ? "no title" : !company ? "no company" : "stat row (View all / count)";
        rows.push(row);
        return;
      }
      pushJob(jobs, seen, {
        company,
        title,
        jobLink: href,
        listingUrl: href,
        source: "hiringcafe",
        employmentType: employmentTypeFromCard(card),
      });
      row.kept = true;
      rows.push(row);
    });
    return { jobs, rows };
  }

  function scrapeHiringCafe() {
    const fromData = jobsFromHiringCafeData();
    const dom = scrapeHiringCafeDom();
    const fromDom = dom.jobs;
    const visible = document.querySelector('a[href*="/job/"]')?.getAttribute("href") || "";
    const slug = visible.split("?")[0].split("/").pop() || "";
    const dataHasVisible =
      fromData.length > 0 &&
      fromData.some((job) => {
        const link = `${job.listingUrl || ""} ${job.jobLink || ""} ${job.externalId || ""}`;
        const req = slug.split("-").pop() || "";
        return (slug && link.includes(slug)) || (req && job.externalId === req);
      });
    const jobs = fromData.length > 0 && dataHasVisible ? fromData : fromDom;
    return { jobs, ...findNext() };
  }

  function scrapePage() {
    const host = location.hostname.toLowerCase();
    if (host.endsWith("indeed.com")) return scrapeIndeed();
    if (host.endsWith("dice.com")) return scrapeDice();
    if (host.endsWith("builtin.com")) return scrapeBuiltin();
    if (host.endsWith("hiringcafe.com")) return scrapeHiringCafe();
    return { jobs: [], unsupported: true };
  }

  function clickNext() {
    const el = document.querySelector(
      "a[rel='next'], a[aria-label='Next' i], a[aria-label='Next Page' i], a[data-testid='pagination-page-next'], button[aria-label='Next' i], button[aria-label='Next Page' i]",
    );
    if (!el) return { clicked: false };
    el.click();
    return { clicked: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "scrape") {
      sendResponse(scrapePage());
      return;
    }
    if (message?.type === "clickNext") {
      sendResponse(clickNext());
    }
  });
}

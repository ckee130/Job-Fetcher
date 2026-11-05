/** Extension jobsite filter ids → job-link host suffixes. */
export const JOB_SITE_HOSTS = {
  greenhouse: ["greenhouse.io", "grnh.se"],
  ashby: ["ashbyhq.com"],
  lever: ["lever.co"],
  smartrecruiters: ["smartrecruiters.com"],
  workable: ["workable.com"],
  workday: ["myworkdayjobs.com", "workday.com"],
  rippling: ["rippling.com"],
} as const;

export type JobSiteId = keyof typeof JOB_SITE_HOSTS;

export const JOB_SITE_IDS = Object.keys(JOB_SITE_HOSTS) as JobSiteId[];

function hostMatches(hostname: string, suffixes: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return suffixes.some((suffix) => {
    const needle = suffix.toLowerCase().replace(/^\./, "");
    return host === needle || host.endsWith(`.${needle}`);
  });
}

/** Greenhouse also embeds on company sites via ?gh_jid=… */
function matchesGreenhouse(url: URL): boolean {
  if (hostMatches(url.hostname, JOB_SITE_HOSTS.greenhouse)) return true;
  return url.searchParams.has("gh_jid");
}

function matchesSite(id: JobSiteId, url: URL): boolean {
  if (id === "greenhouse") return matchesGreenhouse(url);
  return hostMatches(url.hostname, JOB_SITE_HOSTS[id]);
}

function parseJobLink(jobLink: string): URL | null {
  try {
    return new URL(jobLink);
  } catch {
    return null;
  }
}

/** True when no filter, "all", or the link matches a selected ATS. */
export function jobLinkMatchesJobSites(jobLink: string, sites: readonly string[]): boolean {
  const selected = new Set(
    sites.map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  if (selected.size === 0 || selected.has("all")) return true;

  const url = parseJobLink(jobLink);
  if (!url) return false;

  for (const id of JOB_SITE_IDS) {
    if (selected.has(id) && matchesSite(id, url)) return true;
  }
  return false;
}

/** True when the link matches any of the excluded ATS sites (e.g. greenhouse/ashby). */
export function jobLinkMatchesExcludedJobSites(
  jobLink: string,
  excluded: readonly string[],
): boolean {
  const blocked = new Set(
    excluded.map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  if (blocked.size === 0) return false;

  const url = parseJobLink(jobLink);
  if (!url) return false;

  for (const id of JOB_SITE_IDS) {
    if (blocked.has(id) && matchesSite(id, url)) return true;
  }
  return false;
}

/** Labels for progress / skip messages. */
export function jobSiteFilterLabel(sites: readonly string[]): string {
  const selected = sites.map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (selected.length === 0 || selected.includes("all")) return "all";
  return selected.join(" / ");
}

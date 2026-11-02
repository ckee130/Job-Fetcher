/** Extension jobsite filter ids → job-link host suffixes. */
export const JOB_SITE_HOSTS = {
  greenhouse: ["greenhouse.io"],
  ashby: ["ashbyhq.com"],
  lever: ["lever.co"],
  smartrecruiters: ["smartrecruiters.com"],
  workable: ["workable.com"],
  workday: ["myworkdayjobs.com", "workday.com"],
  rippling: ["rippling.com"],
} as const;

export type JobSiteId = keyof typeof JOB_SITE_HOSTS;

export const JOB_SITE_IDS = Object.keys(JOB_SITE_HOSTS) as JobSiteId[];

/** Expand selected site ids to host suffixes. Empty / "all" → no filter. */
export function hostsForJobSites(sites: readonly string[]): string[] {
  const selected = new Set(
    sites.map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  if (selected.size === 0 || selected.has("all")) return [];

  const hosts: string[] = [];
  for (const id of JOB_SITE_IDS) {
    if (!selected.has(id)) continue;
    for (const host of JOB_SITE_HOSTS[id]) hosts.push(host);
  }
  return hosts;
}

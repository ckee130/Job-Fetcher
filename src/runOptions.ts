/**
 * CLI run options shared by fetchers.
 *
 * `--type=contract` (also `--type:contract`) — only Contract roles.
 * JobRight also keeps jobs posted within the last 3 days and scans deeper
 * to collect as many matches as possible.
 */

export type EmploymentTypeFilter = "contract" | null;

let employmentTypeFilter: EmploymentTypeFilter = null;

export function getEmploymentTypeFilter(): EmploymentTypeFilter {
  return employmentTypeFilter;
}

export function isContractMode(): boolean {
  return employmentTypeFilter === "contract";
}

/** JobRight: only keep jobs posted within this many days when in contract mode. */
export const JOBRIGHT_CONTRACT_MAX_AGE_DAYS = 3;

/**
 * JobRight: max recommendation pages to scan in contract mode while collecting matches.
 * (20 jobs/page → up to 1000 listings scanned.)
 */
export const JOBRIGHT_CONTRACT_SCAN_PAGES = 50;

export function resolveEmploymentTypeFilter(argv: string[]): EmploymentTypeFilter {
  const flags = argv
    .map((a) => {
      if (a.startsWith("--type=")) return a.slice("--type=".length);
      if (a.startsWith("--type:")) return a.slice("--type:".length);
      return "";
    })
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  if (flags.length === 0) {
    employmentTypeFilter = null;
    return null;
  }

  const unknown: string[] = [];
  let filter: EmploymentTypeFilter = null;
  for (const raw of flags) {
    if (raw === "contract" || raw === "contractor") {
      filter = "contract";
      continue;
    }
    unknown.push(raw);
  }
  if (unknown.length > 0) {
    throw new Error(
      `Unknown --type=${unknown.join(", ")}. Currently supported: contract`,
    );
  }
  employmentTypeFilter = filter;
  return filter;
}

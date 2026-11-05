/** Trailing legal / entity words stripped for company matching. */
const LEGAL_SUFFIXES = [
  "incorporated",
  "corporation",
  "company",
  "limited",
  "llc",
  "llp",
  "pllc",
  "plc",
  "inc",
  "corp",
  "ltd",
  "lp",
  "pc",
  "co",
] as const;

/**
 * Canonical company key for sheet / within-run / CV dedupe.
 * "Keyfactor, Inc." / "Keyfactor Inc." / "Keyfactor" → "keyfactor"
 * "King LLC" / "King" → "king"
 */
export function normalizeCompany(name: string): string {
  let s = name
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  let changed = true;
  while (changed && s) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (s === suffix) {
        s = "";
        changed = true;
        break;
      }
      const tail = ` ${suffix}`;
      if (s.endsWith(tail)) {
        s = s.slice(0, -tail.length).trim();
        changed = true;
        break;
      }
    }
  }

  return s;
}

export function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

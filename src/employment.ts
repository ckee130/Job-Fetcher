import { getEmploymentTypeFilter } from "./runOptions.js";

/**
 * Normalize employment / commitment labels from Hiring Cafe, Built In, JobRight
 * into a short display value (Full-time, Contract, …).
 */
export function normalizeEmploymentType(raw: unknown): string | undefined {
  const parts = flattenEmploymentRaw(raw);
  if (parts.length === 0) return undefined;

  const mapped = parts
    .map((p) => mapOneEmploymentLabel(p))
    .filter((p): p is string => Boolean(p));
  if (mapped.length === 0) return undefined;

  // Prefer distinct labels in a stable order.
  const order = ["Full-time", "Contract", "Part-time", "Temporary", "Internship", "Seasonal"];
  const unique = [...new Set(mapped)];
  unique.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return unique.join(", ");
}

function flattenEmploymentRaw(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => flattenEmploymentRaw(item));
  }
  if (typeof raw === "string") {
    return raw
      .split(/[,|/]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function mapOneEmploymentLabel(raw: string): string | undefined {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!key) return undefined;

  if (/full\s*time/.test(key) || key === "fulltime") return "Full-time";
  if (/part\s*time/.test(key) || key === "parttime") return "Part-time";
  if (/contract|contractor|freelance/.test(key)) return "Contract";
  if (/temp(orary)?/.test(key)) return "Temporary";
  if (/intern/.test(key)) return "Internship";
  if (/seasonal/.test(key)) return "Seasonal";
  if (/volunteer/.test(key)) return "Volunteer";

  // Preserve unknown labels with light title-casing.
  return raw.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** True when normalized type includes Contract (or filter is off). */
export function matchesEmploymentTypeFilter(
  employmentType: string | undefined,
): boolean {
  const filter = getEmploymentTypeFilter();
  if (!filter) return true;
  if (filter === "contract") {
    return Boolean(employmentType && /(^|,\s*)Contract(,|$)/.test(employmentType));
  }
  return true;
}

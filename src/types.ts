export type JobSource = "hiringcafe" | "builtin" | "jobright" | "dice" | "indeed";

export type JobRecord = {
  company: string;
  title: string;
  /** Prefer employer apply URL; falls back to source listing URL. */
  jobLink: string;
  source: JobSource;
  /** Aggregator listing URL when jobLink is the employer URL. */
  listingUrl?: string;
  /** Stable id used for dedupe when present */
  externalId?: string;
  /** Full-time, Contract, Part-time, … when the source provides it. */
  employmentType?: string;
};

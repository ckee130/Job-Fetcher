export type JobSource = "hiringcafe" | "builtin";

export type JobRecord = {
  company: string;
  title: string;
  /** Prefer employer apply URL; falls back to source listing URL. */
  jobLink: string;
  source: JobSource;
  /** Aggregator listing URL (hiringcafe.com / builtin.com) when jobLink is the employer URL. */
  listingUrl?: string;
  /** Stable id used for dedupe when present */
  externalId?: string;
};

export type FetchResult = {
  source: JobSource;
  jobs: JobRecord[];
  pagesFetched: number;
  error?: string;
};

export type RunSummary = {
  startedAt: string;
  finishedAt: string;
  fetchedTotal: number;
  newJobs: JobRecord[];
  skippedDuplicates: number;
  bySource: Record<
    JobSource,
    { fetched: number; newCount: number; pagesFetched: number; error?: string }
  >;
  outputPath: string;
  sheets?: {
    appended: number;
    skipped: boolean;
    spreadsheetId?: string;
    error?: string;
  };
};

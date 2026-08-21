export type JobSource = "hiringcafe" | "builtin";

export type JobRecord = {
  company: string;
  title: string;
  jobLink: string;
  source: JobSource;
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
};

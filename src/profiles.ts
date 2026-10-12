import { parseProxyUrl } from "./proxy.js";

const US_REMOTE = {
  id: "FxY1yZQBoEtHp_8UEq7V",
  types: ["country"],
  address_components: [
    {
      long_name: "United States",
      short_name: "US",
      types: ["country"],
    },
  ],
  formatted_address: "United States",
  population: 327167434,
  workplace_types: ["Remote"],
  options: { flexible_regions: [] as string[] },
} as const;

const COMMITMENT_TYPES = [
  "Full Time",
  "Contract",
  "Part Time",
  "Temporary",
  "Seasonal",
] as const;

const ENGINEERING_DEPARTMENTS = [
  "Software Development",
  "Data and Analytics",
  "Engineering",
  "Information Technology",
] as const;

/** Hiring Cafe "Date Posted" window (days). */
const HC_DATE_FETCHED_PAST_N_DAYS = 2;

export type BuiltinSearch = {
  path: string;
  params: Record<string, string>;
};

export type Profile = {
  /** Google Sheet tab name and CV subfolder name. */
  name: string;
  /** Per-profile HTTP proxy; falls back to PROXY_URL when unset. */
  proxyUrl?: string;
  /** Hiring Cafe searchState payload (per profile). */
  hiringCafe: Record<string, unknown>;
  /** Hiring Cafe path (default `/`; Daniel uses `/classic`). */
  hiringCafePath?: string;
  /** Three Built In saved searches per profile. */
  builtinSearches: BuiltinSearch[];
  /**
   * Only upload when the company already has a CV file in at least one of
   * these peer profile folders (e.g. Blake → Clinton or Nathan).
   */
  requireCvInProfiles?: readonly string[];
  /**
   * When true (with requireCvInProfiles), also skip jobs whose company+role
   * already exists on a peer Google Sheet tab.
   */
  skipSameRoleOnPeerSheets?: boolean;
  /** When true, skip local CV folder dedupe — sheet company check only. */
  skipCvDirCheck?: boolean;
  /** Absolute resume root for this profile (overrides CV_DIR template). */
  cvRootDir?: string;
  /**
   * How local company presence is detected:
   * - filename (default): any file name containing the company
   * - subdir: a child folder named after the company (Eric/Jay/Daniel)
   */
  cvMatchMode?: "filename" | "subdir";
  /** When true, skip Google Sheet company dedupe (local check only). */
  skipSheetCompanyCheck?: boolean;
  /**
   * JobRight env prefix. Default: JOBRIGHT_EMAIL/PASSWORD/SESSION_ID.
   * Daniel uses DANIEL_JOBRIGHT_* (separate account + session file).
   */
  jobrightEnvPrefix?: string;
};

const BUILTIN_USA = {
  daysSinceUpdated: "1",
  country: "USA",
  allLocations: "true",
} as const;

const BUILTIN_GBR = {
  daysSinceUpdated: "1",
  city: "",
  state: "",
  country: "GBR",
  allLocations: "true",
} as const;

/** USA senior/expert-leader searches shared by Clinton and Blake. */
const CLINTON_BUILTIN_SEARCHES: BuiltinSearch[] = [
  {
    path: "/jobs/remote/data-analytics/data-engineering/senior/expert-leader",
    params: { ...BUILTIN_USA },
  },
  {
    path: "/jobs/remote/engineering/software-engineering/devops-platform-engineering/qa-test-engineering/security-engineering/systems-engineering/senior/expert-leader",
    params: { ...BUILTIN_USA },
  },
  {
    path: "/jobs/remote/ai-machine-learning/senior/expert-leader",
    params: { ...BUILTIN_USA },
  },
];

/** USA senior searches shared by Nathan, Eric, Jay, Daniel. */
const NATHAN_BUILTIN_SEARCHES: BuiltinSearch[] = [
  {
    path: "/jobs/remote/data-analytics/data-engineering/senior",
    params: { ...BUILTIN_USA },
  },
  {
    path: "/jobs/remote/engineering/software-engineering/devops-platform-engineering/qa-test-engineering/security-engineering/systems-engineering/senior",
    params: { ...BUILTIN_USA },
  },
  {
    path: "/jobs/remote/ai-machine-learning/senior",
    params: { ...BUILTIN_USA },
  },
];

const CLINTON_HIRING_CAFE = {
  locations: [US_REMOTE],
  commitmentTypes: [...COMMITMENT_TYPES],
  dateFetchedPastNDays: HC_DATE_FETCHED_PAST_N_DAYS,
  departments: [...ENGINEERING_DEPARTMENTS],
  roleYoeRange: [5, 10],
  roleTypes: ["Individual Contributor"],
  excludeAllLicensesAndCertifications: true,
  securityClearances: ["None"],
  sortBy: "date",
} as const;

const NATHAN_HIRING_CAFE = {
  locations: [US_REMOTE],
  commitmentTypes: [...COMMITMENT_TYPES],
  dateFetchedPastNDays: HC_DATE_FETCHED_PAST_N_DAYS,
  departments: [...ENGINEERING_DEPARTMENTS],
  roleYoeRange: [4, 8],
  roleTypes: ["Individual Contributor"],
  excludeAllLicensesAndCertifications: true,
  securityClearances: ["None"],
  sortBy: "date",
} as const;

const DANIEL_HIRING_CAFE = {
  locations: [
    {
      formatted_address: "United States",
      types: ["country"],
      geometry: { location: { lat: 42.35843, lon: -71.05977 } },
      id: "user_country",
      address_components: [
        {
          long_name: "United States",
          short_name: "US",
          types: ["country"],
        },
      ],
      options: {
        flexible_regions: ["anywhere_in_continent", "anywhere_in_world"],
      },
      workplace_types: ["Remote"],
    },
  ],
  dateFetchedPastNDays: 4,
  departments: [
    "Data and Analytics",
    "Software Development",
    "Information Technology",
    "Engineering",
  ],
  roleYoeRange: [0, 4],
  securityClearances: ["None"],
  sortBy: "date",
} as const;

function remoteCvDir(profileName: string): string {
  return `D:\\Remote\\CV\\${profileName}`;
}

function usResumeDir(profileName: string): string {
  return `E:\\Data\\RM\\US Resume\\Resumes\\${profileName}`;
}

export const PROFILES = {
  Clinton: {
    name: "Clinton",
    cvRootDir: remoteCvDir("Clinton"),
    cvMatchMode: "filename",
    hiringCafe: CLINTON_HIRING_CAFE,
    builtinSearches: CLINTON_BUILTIN_SEARCHES,
  },
  Nathan: {
    name: "Nathan",
    cvRootDir: remoteCvDir("Nathan"),
    cvMatchMode: "filename",
    hiringCafe: NATHAN_HIRING_CAFE,
    builtinSearches: NATHAN_BUILTIN_SEARCHES,
  },
  Andrei: {
    name: "Andrei",
    cvRootDir: remoteCvDir("Andrei"),
    cvMatchMode: "filename",
    proxyUrl: parseProxyUrl(process.env.ANDREI_PROXY_URL || ""),
    hiringCafe: {
      workplaceTypes: ["Remote"],
      commitmentTypes: [...COMMITMENT_TYPES],
      dateFetchedPastNDays: HC_DATE_FETCHED_PAST_N_DAYS,
      departments: [
        "Engineering",
        "Software Development",
        "Information Technology",
        "Data and Analytics",
      ],
      roleYoeRange: [2, 6],
      roleTypes: ["Individual Contributor"],
      securityClearances: ["None"],
    },
    builtinSearches: [
      {
        path: "/jobs/remote/ai-machine-learning/senior",
        params: { ...BUILTIN_GBR },
      },
      {
        path: "/jobs/remote/engineering/software-engineering/devops-platform-engineering/qa-test-engineering/security-engineering/systems-engineering/senior",
        params: { ...BUILTIN_GBR },
      },
      {
        path: "/jobs/remote/data-analytics/data-engineering/senior",
        params: { ...BUILTIN_GBR },
      },
    ],
  },
  Blake: {
    name: "Blake",
    cvRootDir: remoteCvDir("Blake"),
    cvMatchMode: "filename",
    /** Same searches as Clinton; company must exist in Clinton/Nathan CVs. */
    requireCvInProfiles: ["Clinton", "Nathan"],
    /** Skip when Clinton or Nathan sheet already has the same company + role. */
    skipSameRoleOnPeerSheets: true,
    hiringCafe: CLINTON_HIRING_CAFE,
    builtinSearches: CLINTON_BUILTIN_SEARCHES,
  },
  Eric: {
    name: "Eric",
    cvRootDir: usResumeDir("Eric"),
    cvMatchMode: "subdir",
    skipSheetCompanyCheck: true,
    hiringCafe: NATHAN_HIRING_CAFE,
    builtinSearches: NATHAN_BUILTIN_SEARCHES,
  },
  Jay: {
    name: "Jay",
    cvRootDir: usResumeDir("Jay"),
    cvMatchMode: "subdir",
    skipSheetCompanyCheck: true,
    hiringCafe: NATHAN_HIRING_CAFE,
    builtinSearches: NATHAN_BUILTIN_SEARCHES,
  },
  Daniel: {
    name: "Daniel",
    cvRootDir: usResumeDir("Daniel"),
    cvMatchMode: "subdir",
    skipSheetCompanyCheck: true,
    hiringCafePath: "/classic",
    hiringCafe: DANIEL_HIRING_CAFE,
    builtinSearches: NATHAN_BUILTIN_SEARCHES,
    jobrightEnvPrefix: "DANIEL_JOBRIGHT",
  },
} as const satisfies Record<string, Profile>;

export type ProfileName = keyof typeof PROFILES;

export function listProfiles(): ProfileName[] {
  return Object.keys(PROFILES) as ProfileName[];
}

let activeProfile: Profile | null = null;

export function setActiveProfile(name: string): Profile {
  const key = name.trim();
  const match = listProfiles().find((p) => p.toLowerCase() === key.toLowerCase());
  if (!match) {
    throw new Error(`Unknown profile "${name}". Use: ${listProfiles().join(", ")}`);
  }
  activeProfile = PROFILES[match];
  return activeProfile;
}

export function getActiveProfile(): Profile {
  if (!activeProfile) {
    throw new Error(
      `No profile selected. Pass --profile=${listProfiles().join("|")} (or set PROFILE in .env)`,
    );
  }
  return activeProfile;
}

export function getActiveProxyUrl(): string {
  const profile = getActiveProfile();
  return (profile.proxyUrl || "").trim();
}

/** `--profile=Clinton` or PROFILE env. */
export function resolveProfileName(argv: string[]): string {
  const flag = argv.find((a) => a.startsWith("--profile="));
  if (flag) return flag.slice("--profile=".length).trim();
  const fromEnv = (process.env.PROFILE || "").trim();
  if (fromEnv) return fromEnv;
  throw new Error(
    `Missing profile. Pass --profile=${listProfiles().join("|")} or set PROFILE in .env`,
  );
}

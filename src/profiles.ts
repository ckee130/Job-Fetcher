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
  hiringCafe: Record<string, unknown>;
  /** Three Built In saved searches per profile. */
  builtinSearches: BuiltinSearch[];
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

export const PROFILES = {
  Clinton: {
    name: "Clinton",
    hiringCafe: {
      locations: [US_REMOTE],
      commitmentTypes: [...COMMITMENT_TYPES],
      dateFetchedPastNDays: HC_DATE_FETCHED_PAST_N_DAYS,
      departments: [...ENGINEERING_DEPARTMENTS],
      roleYoeRange: [5, 10],
      roleTypes: ["Individual Contributor"],
      excludeAllLicensesAndCertifications: true,
      securityClearances: ["None"],
      sortBy: "date",
    },
    builtinSearches: [
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
    ],
  },
  Nathan: {
    name: "Nathan",
    hiringCafe: {
      locations: [US_REMOTE],
      commitmentTypes: [...COMMITMENT_TYPES],
      dateFetchedPastNDays: HC_DATE_FETCHED_PAST_N_DAYS,
      departments: [...ENGINEERING_DEPARTMENTS],
      roleYoeRange: [4, 8],
      roleTypes: ["Individual Contributor"],
      excludeAllLicensesAndCertifications: true,
      securityClearances: ["None"],
      sortBy: "date",
    },
    builtinSearches: [
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
    ],
  },
  Andrei: {
    name: "Andrei",
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
      `No profile selected. Pass --profile=Clinton|Nathan|Andrei (or set PROFILE in .env)`,
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
    `Missing profile. Pass --profile=Clinton|Nathan|Andrei or set PROFILE in .env`,
  );
}

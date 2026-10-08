import { parseProxyUrl } from "./proxy.js";

export type BuiltinSearch = {
  path: string;
  params: Record<string, string>;
};

export type Profile = {
  /** Google Sheet tab name and CV subfolder name. */
  name: string;
  /** Per-profile HTTP proxy; falls back to PROXY_URL when unset. */
  proxyUrl?: string;
  /** Three Built In saved searches per profile. */
  builtinSearches: BuiltinSearch[];
  /**
   * Only upload when the company already has a CV file in at least one of
   * these peer profile folders (e.g. Blake → Clinton or Nathan).
   */
  requireCvInProfiles?: readonly string[];
  /** When true, skip local CV folder dedupe — sheet company check only. */
  skipCvDirCheck?: boolean;
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

/** USA senior searches shared by Nathan and Kami. */
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

export const PROFILES = {
  Clinton: {
    name: "Clinton",
    builtinSearches: CLINTON_BUILTIN_SEARCHES,
  },
  Nathan: {
    name: "Nathan",
    builtinSearches: NATHAN_BUILTIN_SEARCHES,
  },
  Andrei: {
    name: "Andrei",
    proxyUrl: parseProxyUrl(process.env.ANDREI_PROXY_URL || ""),
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
    /** Same Built In searches as Clinton; only upload companies already in Clinton or Nathan CVs. */
    requireCvInProfiles: ["Clinton", "Nathan"],
    builtinSearches: CLINTON_BUILTIN_SEARCHES,
  },
  Kami: {
    name: "Kami",
    /** Same Built In searches as Nathan; dedupe against sheet only (no local CV folder). */
    skipCvDirCheck: true,
    builtinSearches: NATHAN_BUILTIN_SEARCHES,
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
      `No profile selected. Pass --profile=Clinton|Nathan|Andrei|Blake|Kami (or set PROFILE in .env)`,
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
    `Missing profile. Pass --profile=Clinton|Nathan|Andrei|Blake|Kami or set PROFILE in .env`,
  );
}

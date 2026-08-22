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

export type Profile = {
  /** Google Sheet tab name and CV subfolder name. */
  name: string;
  hiringCafe: Record<string, unknown>;
  builtin: {
    path: string;
    params: Record<string, string>;
  };
};

export const PROFILES = {
  Clinton: {
    name: "Clinton",
    hiringCafe: {
      locations: [US_REMOTE],
      commitmentTypes: [...COMMITMENT_TYPES],
      dateFetchedPastNDays: 4,
      departments: [...ENGINEERING_DEPARTMENTS],
      roleYoeRange: [5, 10],
      roleTypes: ["Individual Contributor"],
      excludeAllLicensesAndCertifications: true,
      securityClearances: ["None"],
      sortBy: "date",
    },
    builtin: {
      path: "/jobs/remote/data-analytics/senior/expert-leader",
      params: {
        daysSinceUpdated: "3",
        country: "USA",
        allLocations: "true",
      },
    },
  },
  Nathan: {
    name: "Nathan",
    hiringCafe: {
      locations: [US_REMOTE],
      commitmentTypes: [...COMMITMENT_TYPES],
      dateFetchedPastNDays: 4,
      departments: [...ENGINEERING_DEPARTMENTS],
      roleYoeRange: [4, 8],
      roleTypes: ["Individual Contributor"],
      excludeAllLicensesAndCertifications: true,
      securityClearances: ["None"],
      sortBy: "date",
    },
    builtin: {
      path: "/jobs/remote/data-analytics/senior",
      params: {
        daysSinceUpdated: "3",
        country: "USA",
        allLocations: "true",
      },
    },
  },
  Andrei: {
    name: "Andrei",
    hiringCafe: {
      workplaceTypes: ["Remote"],
      commitmentTypes: [...COMMITMENT_TYPES],
      dateFetchedPastNDays: 4,
      roleYoeRange: [2, 6],
      roleTypes: ["Individual Contributor"],
      securityClearances: ["None"],
    },
    builtin: {
      path: "/jobs/remote/data-analytics/mid-level/senior",
      params: {
        daysSinceUpdated: "3",
        city: "London",
        state: "England",
        country: "GBR",
        allLocations: "true",
      },
    },
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

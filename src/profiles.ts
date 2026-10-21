export type Profile = {
  /** Google Sheet tab name and CV subfolder name. */
  name: string;
  /**
   * Peer CV folders for company+role local dedupe (Blake → Clinton/Nathan).
   * Skip when a peer filename already has the same company + role.
   * Same company with a different role is still uploaded.
   */
  skipSameRoleOnPeerCvs?: readonly string[];
  /**
   * Other profile sheet tabs. After the usual checks, skip when the same
   * company and role is already on any one of these sheets. Sheet rows only.
   */
  peerSheetNames?: readonly string[];
  /** Absolute resume root for this profile (overrides CV_DIR template). */
  cvRootDir?: string;
  /**
   * How local company presence is detected:
   * - filename (default): any file name containing the company
   * - subdir: a child folder named after the company (Eric/Jay/Daniel/Luke)
   */
  cvMatchMode?: "filename" | "subdir";
  /** When true, skip Google Sheet company dedupe (local check only). */
  skipSheetCompanyCheck?: boolean;
};

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
    peerSheetNames: ["Nathan", "Blake"],
  },
  Nathan: {
    name: "Nathan",
    cvRootDir: remoteCvDir("Nathan"),
    cvMatchMode: "filename",
    peerSheetNames: ["Clinton", "Blake"],
  },
  Blake: {
    name: "Blake",
    cvRootDir: remoteCvDir("Blake"),
    cvMatchMode: "filename",
    /** Skip same company+role already in Clinton/Nathan CV files. */
    skipSameRoleOnPeerCvs: ["Clinton", "Nathan"],
    peerSheetNames: ["Clinton", "Nathan"],
  },
  Eric: {
    name: "Eric",
    cvRootDir: usResumeDir("Eric"),
    cvMatchMode: "subdir",
    skipSheetCompanyCheck: true,
  },
  Jay: {
    name: "Jay",
    cvRootDir: usResumeDir("Jay"),
    cvMatchMode: "subdir",
    skipSheetCompanyCheck: true,
  },
  Daniel: {
    name: "Daniel",
    cvRootDir: usResumeDir("Daniel"),
    cvMatchMode: "subdir",
    skipSheetCompanyCheck: true,
  },
  Luke: {
    name: "Luke",
    cvRootDir: usResumeDir("Luke"),
    cvMatchMode: "subdir",
    skipSheetCompanyCheck: true,
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
    throw new Error("No profile selected.");
  }
  return activeProfile;
}

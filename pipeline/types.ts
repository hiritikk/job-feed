export type Country = "CA" | "US" | "GB" | "EU" | "OTHER";
export type RoleType = "sde" | "ml-ai" | "backend" | "fullstack" | "infra" | "data" | "other";
export type Level = "new-grad" | "early-career" | "other";
export type WorkAuth = "none" | "restricted" | "sponsors" | "unknown";
export type RemoteMode = "remote" | "hybrid" | "onsite" | "unknown";
export type Tier = 1 | 2 | 3;

export type Job = {
  id: string;
  company: string;
  title: string;
  url: string;
  locations: string[];
  countries: Country[];
  remote: RemoteMode;
  remoteRegions: string[];
  postedAt: string;
  postedApprox: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  closedAt: string | null;
  source: string;
  sources: string[];
  roleType: RoleType;
  level: Level;
  gradYear: 2026 | 2027 | 2028 | null;
  workAuth: WorkAuth;
  tier: Tier;
  snippet: string;
};

export type RawJob = {
  source: string;
  sourceId: string;
  company: string;
  title: string;
  url: string;
  locations: string[];
  postedAt: string | null;
  postedApprox?: boolean;
  descriptionHtml?: string;
  remoteHint?: boolean;
  sponsorshipHint?: string;
};

export type SourceHealth = {
  source: string;
  status: "ok" | "stale" | "failed";
  lastSuccessAt: string | null;
  jobCount: number;
  error?: string;
};

export type Http = {
  json<T = unknown>(url: string, init?: RequestInit): Promise<T>;
  text(url: string, init?: RequestInit): Promise<string>;
};

export type CompanyEntry = {
  name: string;
  ats: "greenhouse" | "lever" | "ashby" | "workday" | "workable" | "smartrecruiters";
  slug: string;
  tier: Tier;
  site?: string;
  wd?: number;
};

export type JobsFile = { generatedAt: string; sources: SourceHealth[]; jobs: Job[] };

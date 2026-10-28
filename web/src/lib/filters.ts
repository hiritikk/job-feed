import type { Country, Job, Level, RoleType, Tier } from "./types";

export type LocationKey = "CA" | "REMOTE" | "US" | "GB" | "EU" | "OTHER";
export type SortKey = "posted" | "found";
export type Filters = {
  locations: LocationKey[];
  cities: string[];
  roleTypes: RoleType[];
  levels: Level[];
  gradYears: (number | "none")[];
  tiers: Tier[];
  sources: string[];
  postedWithinDays: 1 | 3 | 7 | 30 | null;
  hideRestricted: boolean;
  includeClosed: boolean;
  sort: SortKey;
  q: string;
};

export const LOCATION_KEYS: LocationKey[] = ["CA", "REMOTE", "US", "GB", "EU", "OTHER"];
export const ROLE_TYPES: RoleType[] = ["sde", "ml-ai", "backend", "fullstack", "infra", "data"];
export const LEVELS: Level[] = ["new-grad", "early-career", "other"];
const DAYS = [1, 3, 7, 30] as const;
const DAY_MS = 86_400_000;

export const defaultFilters = (): Filters => ({
  locations: ["CA", "REMOTE"], cities: [], roleTypes: [...ROLE_TYPES], levels: ["new-grad", "early-career"], gradYears: [],
  tiers: [1, 2, 3], sources: [], postedWithinDays: null, hideRestricted: true, includeClosed: false, sort: "posted", q: "",
});

/** The date a job should be ordered and aged by: the posting date when we know it, otherwise when we first found it. */
export const effectiveDate = (job: Job): string => (job.postedPrecision === "none" ? job.firstSeenAt : job.postedAt);

function matchesLocation(job: Job, chips: LocationKey[]): boolean {
  if (chips.length === 0) return true;
  const countryChips = chips.filter((c): c is Country => c !== "REMOTE");
  if (job.countries.some((c) => countryChips.includes(c))) return true;
  if (chips.includes("REMOTE") && job.remote === "remote") {
    if (job.remoteRegions.length === 0) return true; // remote, region not stated
    const eligible = new Set<string>([...countryChips, "CA"]); // remote roles open to Canada are always relevant here
    return job.remoteRegions.some((r) => eligible.has(r));
  }
  return false;
}

export function applyFilters(jobs: Job[], f: Filters, now: Date): Job[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const cutoff = f.postedWithinDays === null ? null : now.getTime() - f.postedWithinDays * DAY_MS;
  const out = jobs.filter((job) => {
    if (!f.includeClosed && (job.closedAt !== null || job.linkStatus === "dead")) return false;
    if (f.hideRestricted && job.workAuth === "restricted") return false;
    if (f.roleTypes.length > 0 && !f.roleTypes.includes(job.roleType)) return false;
    if (f.levels.length > 0 && !f.levels.includes(job.level)) return false;
    if (f.tiers.length > 0 && !f.tiers.includes(job.tier)) return false;
    if (f.gradYears.length > 0 && !f.gradYears.includes(job.gradYear ?? "none")) return false;
    if (f.sources.length > 0 && !job.sources.some((s) => f.sources.includes(s)) && !f.sources.includes(job.source)) return false;
    if (!matchesLocation(job, f.locations)) return false;
    if (f.cities.length > 0 && !job.cities.some((c) => f.cities.includes(c))) return false;
    if (cutoff !== null && new Date(effectiveDate(job)).getTime() < cutoff) return false;
    if (words.length > 0) {
      const hay = `${job.title} ${job.company} ${job.cities.join(" ")} ${job.locations.join(" ")}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const key = (j: Job): string => (f.sort === "found" ? j.firstSeenAt : effectiveDate(j));
  return out.sort((a, b) => key(b).localeCompare(key(a)));
}

/** City chips: cities of jobs in the chosen countries (all when none chosen), most common first. */
export function cityOptions(jobs: Job[], chips: LocationKey[]): { city: string; count: number }[] {
  const countryChips = chips.filter((c): c is Country => c !== "REMOTE");
  const counts = new Map<string, number>();
  for (const job of jobs) {
    if (countryChips.length > 0 && !job.countries.some((c) => countryChips.includes(c))) continue;
    for (const city of job.cities) counts.set(city, (counts.get(city) ?? 0) + 1);
  }
  return [...counts].map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
}

export const isNewSince = (job: Job, lastVisit: string | null): boolean => lastVisit !== null && job.firstSeenAt > lastVisit;

// ---- URL state ---------------------------------------------------------------------------------------------------
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function filtersToSearch(f: Filters): string {
  const d = defaultFilters();
  const p = new URLSearchParams();
  const list = (key: string, value: unknown[], def: unknown[]) => { if (!same(value, def)) p.set(key, value.join(",")); };
  list("loc", f.locations, d.locations);
  list("role", f.roleTypes, d.roleTypes);
  list("lvl", f.levels, d.levels);
  list("yr", f.gradYears, d.gradYears);
  list("tier", f.tiers, d.tiers);
  list("src", f.sources, d.sources);
  for (const c of f.cities) p.append("city", c);
  if (f.postedWithinDays !== null) p.set("days", String(f.postedWithinDays));
  if (!f.hideRestricted) p.set("restricted", "0");
  if (f.includeClosed) p.set("closed", "1");
  if (f.sort !== "posted") p.set("sort", f.sort);
  if (f.q) p.set("q", f.q);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function searchToFilters(search: string): Filters {
  const p = new URLSearchParams(search);
  const f = defaultFilters();
  /** Present + empty -> []; present with only invalid values -> default; otherwise the valid values. */
  const pick = <T>(key: string, parse: (raw: string) => T | undefined, def: T[]): T[] => {
    const raw = p.get(key);
    if (raw === null) return def;
    if (raw === "") return [];
    const ok = raw.split(",").map(parse).filter((v): v is T => v !== undefined);
    return ok.length > 0 ? ok : def;
  };
  f.locations = pick("loc", (v) => (LOCATION_KEYS as string[]).includes(v) ? (v as LocationKey) : undefined, f.locations);
  f.roleTypes = pick("role", (v) => (ROLE_TYPES as string[]).includes(v) ? (v as RoleType) : undefined, f.roleTypes);
  f.levels = pick("lvl", (v) => (LEVELS as string[]).includes(v) ? (v as Level) : undefined, f.levels);
  f.gradYears = pick("yr", (v) => (v === "none" ? "none" : [2026, 2027, 2028].includes(Number(v)) ? Number(v) : undefined), f.gradYears);
  f.tiers = pick("tier", (v) => (["1", "2", "3"].includes(v) ? (Number(v) as Tier) : undefined), f.tiers);
  f.sources = pick("src", (v) => (/^[a-z0-9-]+$/.test(v) ? v : undefined), f.sources);
  f.cities = p.getAll("city").filter(Boolean);
  const days = Number(p.get("days"));
  f.postedWithinDays = (DAYS as readonly number[]).includes(days) ? (days as Filters["postedWithinDays"]) : null;
  f.hideRestricted = p.get("restricted") !== "0";
  f.includeClosed = p.get("closed") === "1";
  f.sort = p.get("sort") === "found" ? "found" : "posted";
  f.q = p.get("q") ?? "";
  return f;
}

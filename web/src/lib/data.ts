import type { JobsFile } from "./types";

export const DATA_URL: string =
  (import.meta.env?.VITE_DATA_URL as string | undefined) ?? "https://raw.githubusercontent.com/hiritikk/job-feed/data/jobs.json";

export type LoadResult = { ok: true; data: JobsFile } | { ok: false; error: string };

/** Fetches and validates jobs.json. Never throws: the page shows the error instead of a blank screen. */
export async function loadJobs(url: string, fetchImpl: typeof fetch = fetch): Promise<LoadResult> {
  try {
    const res = await fetchImpl(url, { cache: "no-cache" });
    if (!res.ok) return { ok: false, error: `The job data returned HTTP ${res.status}.` };
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: "The job data is not valid JSON (the server may have sent an error page)." };
    }
    const file = data as Partial<JobsFile> | null;
    if (!file || !Array.isArray(file.jobs)) return { ok: false, error: "The job data has no jobs list." };
    return { ok: true, data: { generatedAt: file.generatedAt ?? "", sources: Array.isArray(file.sources) ? file.sources : [], jobs: file.jobs } };
  } catch (err) {
    return { ok: false, error: `Could not load the job data: ${(err as Error).message}` };
  }
}

const KEY = "job-feed:last-visit";
const browserStorage = (): Storage | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

export function readLastVisit(storage: Storage | undefined = browserStorage()): string | null {
  try {
    return storage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeLastVisit(iso: string, storage: Storage | undefined = browserStorage()): void {
  try {
    storage?.setItem(KEY, iso);
  } catch {
    // storage can be blocked (private mode); "new since last visit" just stays off
  }
}

const RAIL_KEY = "job-feed:filters-hidden";

/** The filter panel starts hidden; it is shown only when the visitor has chosen to show it. */
export function readRailHidden(storage: Storage | undefined = browserStorage()): boolean {
  try {
    return storage?.getItem(RAIL_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeRailHidden(hidden: boolean, storage: Storage | undefined = browserStorage()): void {
  try {
    storage?.setItem(RAIL_KEY, hidden ? "1" : "0");
  } catch {
    // blocked storage: the panel simply starts hidden next time
  }
}

const APPLIED_KEY = "job-feed:applied";

/** Jobs the visitor marked as applied: job id -> ISO time of the mark. Kept in this browser only. */
export type Applied = Record<string, string>;

export function readApplied(storage: Storage | undefined = browserStorage()): Applied {
  try {
    const raw = storage?.getItem(APPLIED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "string"));
  } catch {
    return {};
  }
}

export function writeApplied(applied: Applied, storage: Storage | undefined = browserStorage()): void {
  try {
    storage?.setItem(APPLIED_KEY, JSON.stringify(applied));
  } catch {
    // blocked storage: the mark lasts until the page is closed
  }
}

/** Marks a job applied (stamping `at`), or clears the mark when it was already set. */
export function toggleApplied(applied: Applied, id: string, at: string): Applied {
  const { [id]: was, ...rest } = applied;
  return was === undefined ? { ...applied, [id]: at } : rest;
}

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

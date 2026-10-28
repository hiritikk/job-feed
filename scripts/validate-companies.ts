import { pathToFileURL } from "node:url";
import { ATS_FETCHERS, type AtsFetcher } from "../pipeline/adapters/ats.js";
import { loadCompanies } from "../pipeline/config.js";
import { createHttp } from "../pipeline/http.js";
import type { CompanyEntry, Http } from "../pipeline/types.js";

export type Fetchers = Partial<Record<CompanyEntry["ats"], AtsFetcher>>;
export type Validation = { ok: boolean; jobCount: number; error?: string };

/** An entry is valid when its board answers and lists at least one job. "custom" employers are checked by their adapters' own tests. */
export async function validateCompany(entry: CompanyEntry, http: Http, fetchers: Fetchers = ATS_FETCHERS): Promise<Validation> {
  if (entry.ats === "custom") return { ok: true, jobCount: -1 };
  try {
    const fetcher = fetchers[entry.ats];
    if (!fetcher) return { ok: false, jobCount: 0, error: `no fetcher for ats "${entry.ats}"` };
    const jobs = await fetcher(entry, http);
    return jobs.length > 0 ? { ok: true, jobCount: jobs.length } : { ok: false, jobCount: 0, error: "zero jobs" };
  } catch (err) {
    return { ok: false, jobCount: 0, error: (err as Error).message };
  }
}

export async function validateAll(entries: CompanyEntry[], http: Http, fetchers: Fetchers = ATS_FETCHERS, concurrency = 8) {
  const failures: { entry: CompanyEntry; error: string }[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
    while (next < entries.length) {
      const entry = entries[next++];
      const res = await validateCompany(entry, http, fetchers);
      if (!res.ok) failures.push({ entry, error: res.error ?? "unknown" });
    }
  }));
  return { checked: entries.length, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const entries = loadCompanies();
  const { checked, failures } = await validateAll(entries, createHttp());
  for (const f of failures) console.error(`FAIL ${f.entry.ats}:${f.entry.slug} (${f.entry.name}): ${f.error}`);
  console.log(`${checked - failures.length}/${checked} company entries valid`);
  process.exit(failures.length > 0 ? 1 : 0);
}

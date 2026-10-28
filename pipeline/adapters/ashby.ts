import { toIso } from "../normalize.js";
import type { CompanyEntry, Http, RawJob } from "../types.js";

type AshbyJob = {
  id: string; title: string; jobUrl: string; location?: string; secondaryLocations?: { location?: string }[];
  isRemote?: boolean | null; publishedAt?: string; descriptionHtml?: string;
};

export async function fetchAshby(entry: CompanyEntry, http: Http): Promise<RawJob[]> {
  const data = await http.json<{ jobs?: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${entry.slug}`);
  if (!data || !Array.isArray(data.jobs)) throw new Error(`ashby ${entry.slug}: response has no jobs array`);
  return data.jobs.map((j) => ({
    source: "ashby",
    sourceId: j.id,
    company: entry.name,
    title: j.title,
    url: j.jobUrl,
    locations: [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)].filter((l): l is string => !!l),
    postedAt: toIso(j.publishedAt),
    descriptionHtml: j.descriptionHtml,
    remoteHint: j.isRemote ? true : undefined,
  }));
}

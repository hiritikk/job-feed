import { toIso } from "../normalize.js";
import type { CompanyEntry, Http, RawJob } from "../types.js";

type WkJob = {
  title: string; shortcode: string; url: string; telecommuting?: boolean; published_on?: string; created_at?: string;
  city?: string; country?: string; locations?: { city?: string; country?: string }[];
};

export async function fetchWorkable(entry: CompanyEntry, http: Http): Promise<RawJob[]> {
  const data = await http.json<{ jobs?: WkJob[] }>(`https://apply.workable.com/api/v1/widget/accounts/${entry.slug}`);
  if (!data || !Array.isArray(data.jobs)) throw new Error(`workable ${entry.slug}: response has no jobs array`);
  return data.jobs.map((j) => {
    const places = j.locations?.length ? j.locations : [{ city: j.city, country: j.country }];
    return {
      source: "workable",
      sourceId: j.shortcode,
      company: entry.name,
      title: j.title,
      url: j.url,
      locations: places.map((p) => [p.city, p.country].filter(Boolean).join(", ")).filter(Boolean),
      postedAt: toIso(j.published_on ?? j.created_at),
      remoteHint: j.telecommuting ? true : undefined,
    };
  });
}

import type { CompanyEntry, Http, RawJob } from "../types.js";

type RipplingJob = { uuid: string; name: string; url: string; workLocation?: { label?: string } };

/** Rippling's public board lists jobs without dates, so postedAt stays null. */
export async function fetchRippling(entry: CompanyEntry, http: Http): Promise<RawJob[]> {
  const data = await http.json<RipplingJob[]>(`https://api.rippling.com/platform/api/ats/v1/board/${entry.slug}/jobs`);
  if (!Array.isArray(data)) throw new Error(`rippling ${entry.slug}: response is not an array`);
  return data.map((j) => ({
    source: "rippling", sourceId: j.uuid, company: entry.name, title: j.name.trim(), url: j.url,
    locations: j.workLocation?.label ? [j.workLocation.label] : [], postedAt: null,
  }));
}

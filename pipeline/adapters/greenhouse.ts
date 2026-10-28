import { toIso } from "../normalize.js";
import type { CompanyEntry, Http, RawJob } from "../types.js";

type GhJob = {
  id: number; title: string; absolute_url: string; location?: { name?: string } | null;
  first_published?: string; updated_at?: string; content?: string;
};

export async function fetchGreenhouse(entry: CompanyEntry, http: Http): Promise<RawJob[]> {
  const data = await http.json<{ jobs?: GhJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${entry.slug}/jobs?content=true`);
  if (!data || !Array.isArray(data.jobs)) throw new Error(`greenhouse ${entry.slug}: response has no jobs array`);
  return data.jobs.map((j) => ({
    source: "greenhouse",
    sourceId: String(j.id),
    company: entry.name,
    title: j.title,
    url: j.absolute_url,
    locations: j.location?.name ? [j.location.name] : [],
    postedAt: toIso(j.first_published) ?? toIso(j.updated_at),
    descriptionHtml: j.content,
  }));
}

import { toIso } from "../normalize.js";
import type { CompanyEntry, Http, RawJob } from "../types.js";

type LeverJob = {
  id: string; text: string; hostedUrl: string; createdAt?: number; workplaceType?: string;
  categories?: { location?: string; allLocations?: string[] }; description?: string; descriptionPlain?: string;
};

export async function fetchLever(entry: CompanyEntry, http: Http): Promise<RawJob[]> {
  const data = await http.json<LeverJob[]>(`https://api.lever.co/v0/postings/${entry.slug}?mode=json`);
  if (!Array.isArray(data)) throw new Error(`lever ${entry.slug}: response is not an array`);
  return data.map((j) => {
    const all = j.categories?.allLocations?.length ? j.categories.allLocations : j.categories?.location ? [j.categories.location] : [];
    return {
      source: "lever",
      sourceId: j.id,
      company: entry.name,
      title: j.text,
      url: j.hostedUrl,
      locations: all,
      postedAt: toIso(j.createdAt),
      descriptionHtml: j.description ?? j.descriptionPlain,
      remoteHint: j.workplaceType === "remote" ? true : undefined,
    };
  });
}

import { toIso } from "../normalize.js";
import type { CompanyEntry, Http, RawJob } from "../types.js";

type Offer = { id: number; title: string; careers_url: string; location?: string; city?: string; country?: string; remote?: boolean; published_at?: string; created_at?: string; description?: string };

export async function fetchRecruitee(entry: CompanyEntry, http: Http): Promise<RawJob[]> {
  const data = await http.json<{ offers?: Offer[] }>(`https://${entry.slug}.recruitee.com/api/offers/`);
  if (!data || !Array.isArray(data.offers)) throw new Error(`recruitee ${entry.slug}: response has no offers array`);
  return data.offers.map((o) => ({
    source: "recruitee", sourceId: String(o.id), company: entry.name, title: o.title, url: o.careers_url,
    locations: o.location ? [o.location] : [o.city, o.country].filter((x): x is string => !!x).length ? [[o.city, o.country].filter(Boolean).join(", ")] : [],
    postedAt: toIso(o.published_at ?? o.created_at), descriptionHtml: o.description, remoteHint: o.remote ? true : undefined,
  }));
}

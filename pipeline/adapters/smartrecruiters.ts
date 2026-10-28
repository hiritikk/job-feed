import type { CompanyEntry, Http, RawJob } from "../types.js";
import { toIso } from "../normalize.js";

type SrPosting = {
  id: string; name: string; releasedDate?: string;
  location?: { fullLocation?: string; city?: string; country?: string; remote?: boolean };
};

const LIMIT = 100;
const MAX_PAGES = 5;

export async function fetchSmartRecruiters(entry: CompanyEntry, http: Http): Promise<RawJob[]> {
  const out: RawJob[] = [];
  let total = Infinity;
  for (let page = 0; page < MAX_PAGES && page * LIMIT < total; page++) {
    const data = await http.json<{ totalFound?: number; content?: SrPosting[] }>(
      `https://api.smartrecruiters.com/v1/companies/${entry.slug}/postings?limit=${LIMIT}&offset=${page * LIMIT}`,
    );
    if (!data || !Array.isArray(data.content)) throw new Error(`smartrecruiters ${entry.slug}: response has no content array`);
    total = data.totalFound ?? data.content.length;
    for (const p of data.content) {
      out.push({
        source: "smartrecruiters",
        sourceId: p.id,
        company: entry.name,
        title: p.name,
        url: `https://jobs.smartrecruiters.com/${entry.slug}/${p.id}`,
        locations: p.location?.fullLocation ? [p.location.fullLocation] : [],
        postedAt: toIso(p.releasedDate),
        remoteHint: p.location?.remote ? true : undefined,
      });
    }
    if (data.content.length === 0) break;
  }
  return out;
}

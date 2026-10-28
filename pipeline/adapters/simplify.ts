import { toIso } from "../normalize.js";
import type { Http, RawJob } from "../types.js";

type Listing = {
  id: string; company_name: string; title: string; url: string; locations?: string[];
  active?: boolean; is_visible?: boolean; date_posted?: number; sponsorship?: string;
};

/** Shared by every list that uses the SimplifyJobs `listings.json` schema. */
async function fetchListingsJson(http: Http, url: string, source: string): Promise<RawJob[]> {
  const data = await http.json<Listing[]>(url);
  if (!Array.isArray(data)) throw new Error(`${source}: listings.json is not an array`);
  return data
    .filter((l) => l.active === true && l.is_visible !== false)
    .map((l) => ({
      source,
      sourceId: l.id,
      company: l.company_name,
      title: l.title,
      url: l.url,
      locations: l.locations ?? [],
      postedAt: l.date_posted ? toIso(l.date_posted * 1000) : null,
      sponsorshipHint: l.sponsorship,
    }));
}

export const fetchSimplify = (http: Http): Promise<RawJob[]> =>
  fetchListingsJson(http, "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json", "simplify");

export const fetchVanshb03 = (http: Http): Promise<RawJob[]> =>
  fetchListingsJson(http, "https://raw.githubusercontent.com/vanshb03/New-Grad-2027/dev/.github/scripts/listings.json", "vanshb03");

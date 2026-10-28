// Endpoint used by amazon.jobs itself: GET /en/search.json (verified 2026-10-27, no auth).
import { toIso } from "../../normalize.js";
import type { Http, RawJob } from "../../types.js";
import { BigTechOptions, DEFAULT_LOCATIONS, DEFAULT_QUERIES, sleep } from "./util.js";

type AmazonJob = {
  id_icims: string; title: string; job_path: string; normalized_location?: string; location?: string; country_code?: string;
  posted_date?: string; description?: string; basic_qualifications?: string; preferred_qualifications?: string;
};

const COUNTRY: Record<string, string> = { CAN: "Canada", USA: "United States", GBR: "United Kingdom", IRL: "Ireland", DEU: "Germany", FRA: "France", NLD: "Netherlands", ESP: "Spain", POL: "Poland" };
const AMAZON_CODE: Record<string, string> = { Canada: "CAN", "United States": "USA" };
const PAGE = 100;

export async function fetchAmazon(http: Http, opts: BigTechOptions = {}): Promise<RawJob[]> {
  const delayMs = opts.delayMs ?? 1000;
  const seen = new Map<string, RawJob>();
  for (const location of opts.locations ?? DEFAULT_LOCATIONS) {
    for (const query of opts.queries ?? DEFAULT_QUERIES) {
      for (let page = 0; page < (opts.maxPages ?? 3); page++) {
        const code = AMAZON_CODE[location];
        const url = `https://www.amazon.jobs/en/search.json?base_query=${encodeURIComponent(query)}&loc_query=${encodeURIComponent(location)}` +
          (code ? `&normalized_country_code%5B%5D=${code}` : "") + `&result_limit=${PAGE}&offset=${page * PAGE}&sort=recent`;
        const data = await http.json<{ jobs?: AmazonJob[] }>(url);
        if (!data || !Array.isArray(data.jobs)) throw new Error("amazon: response has no jobs array");
        for (const j of data.jobs) {
          const place = (j.normalized_location ?? j.location ?? "").replace(/\b([A-Z]{3})$/, (m) => COUNTRY[m] ?? m);
          seen.set(j.id_icims, {
            source: "amazon", sourceId: j.id_icims, company: "Amazon", title: j.title, url: `https://www.amazon.jobs${j.job_path}`,
            locations: place ? [place] : [], postedAt: j.posted_date ? toIso(`${j.posted_date} UTC`) : null, postedPrecision: "day",
            descriptionHtml: [j.description, j.basic_qualifications, j.preferred_qualifications].filter(Boolean).join(" "),
          });
        }
        if (data.jobs.length < PAGE) break;
        await sleep(delayMs);
      }
      await sleep(delayMs);
    }
  }
  return [...seen.values()];
}

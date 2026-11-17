// Apple's search page is server-rendered: the results are embedded as JSON in window.__staticRouterHydrationData
// (verified 2026-11-16, no auth, no browser needed; jobs.apple.com publishes no robots.txt). Dates are exact timestamps.
import { toIso } from "../../normalize.js";
import type { Http, RawJob } from "../../types.js";
import { sleep, type BigTechOptions } from "./util.js";

type Location = { name?: string; stateProvince?: string; countryName?: string };
type Result = { positionId?: string; postingTitle?: string; transformedPostingTitle?: string; postDateInGMT?: string; jobSummary?: string; locations?: Location[] };
type Search = { searchResults?: Result[]; totalRecords?: number };

const PAGE_SIZE = 20;
// Apple's own location slugs. Canada is small enough to read whole; the United States is read newest-first, a few pages.
export const APPLE_LOCATIONS = ["canada-CANC", "united-states-USA"];

export function parseAppleSearch(html: string): Search {
  const m = /window\.__staticRouterHydrationData = JSON\.parse\("((?:[^"\\]|\\.)*)"\)/.exec(html);
  if (!m) throw new Error("apple: page has no embedded search data");
  const search = (JSON.parse(JSON.parse(`"${m[1]}"`)) as { loaderData?: { search?: Search } }).loaderData?.search;
  if (!search || !Array.isArray(search.searchResults)) throw new Error("apple: embedded data has no searchResults");
  return search;
}

const place = (l: Location): string => [l.name, l.stateProvince, l.countryName].filter(Boolean).join(", ");

export async function fetchApple(http: Http, opts: BigTechOptions = {}): Promise<RawJob[]> {
  const byId = new Map<string, RawJob>();
  let first = true;
  for (const location of opts.locations ?? APPLE_LOCATIONS) {
    for (const query of opts.queries ?? ["software engineer"]) {
      for (let page = 1; page <= (opts.maxPages ?? 3); page++) {
        if (!first) await sleep(opts.delayMs ?? 1000);
        first = false;
        const url = `https://jobs.apple.com/en-ca/search?location=${location}&search=${encodeURIComponent(query)}&sort=newest&page=${page}`;
        const search = parseAppleSearch(await http.text(url));
        for (const r of search.searchResults ?? []) {
          if (!r.positionId || !r.postingTitle) continue;
          const locations = (r.locations ?? []).map(place).filter(Boolean);
          const seen = byId.get(r.positionId);
          if (seen) {
            // one posting is listed once per location
            for (const l of locations) if (!seen.locations.includes(l)) seen.locations.push(l);
            continue;
          }
          byId.set(r.positionId, {
            source: "apple", sourceId: r.positionId, company: "Apple", title: r.postingTitle,
            url: `https://jobs.apple.com/en-ca/details/${r.positionId}/${r.transformedPostingTitle ?? ""}`.replace(/\/$/, ""),
            locations, postedAt: toIso(r.postDateInGMT), descriptionHtml: r.jobSummary,
          });
        }
        if ((search.searchResults ?? []).length < PAGE_SIZE || page * PAGE_SIZE >= (search.totalRecords ?? 0)) break;
      }
    }
  }
  return [...byId.values()];
}

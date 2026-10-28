// apply.careers.microsoft.com is Eightfold; its search page calls /api/pcsx/search (verified 2026-10-27, no auth).
// Only the first page (newest 10 per query/location, sort_by=timestamp) is fetched by default: start=10 answers 429 to
// scripted clients even with long gaps, and we deliberately do not try to get around that.
import { toIso } from "../../normalize.js";
import type { Http, RawJob } from "../../types.js";
import { BigTechOptions, DEFAULT_LOCATIONS, DEFAULT_QUERIES, sleep } from "./util.js";

type Position = { id: number; name: string; locations?: string[]; postedTs?: number; positionUrl: string; workLocationOption?: string };

export async function fetchMicrosoft(http: Http, opts: BigTechOptions = {}): Promise<RawJob[]> {
  const delayMs = opts.delayMs ?? 2000; // the pcsx endpoint answers 429 at ~1 request/second
  const seen = new Map<string, RawJob>();
  for (const location of opts.locations ?? DEFAULT_LOCATIONS) {
    for (const query of opts.queries ?? DEFAULT_QUERIES) {
      for (let page = 0; page < (opts.maxPages ?? 1); page++) {
        let data: { data?: { count?: number; positions?: Position[] } };
        try {
          data = await http.json(
            `https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=${encodeURIComponent(query)}` +
              `&location=${encodeURIComponent(location)}&start=${page * 10}&sort_by=timestamp`,
          );
        } catch (err) {
          // Rate limited mid-run: keep what we have (this source is a newest-N window, so a partial result is safe).
          if (/HTTP 429/.test((err as Error).message) && seen.size > 0) return [...seen.values()];
          throw err;
        }
        const positions = data?.data?.positions;
        if (!Array.isArray(positions)) throw new Error("microsoft: response has no data.positions array");
        for (const p of positions) {
          seen.set(String(p.id), {
            source: "microsoft", sourceId: String(p.id), company: "Microsoft", title: p.name,
            url: `https://apply.careers.microsoft.com${p.positionUrl}`, locations: p.locations ?? [],
            postedAt: p.postedTs ? toIso(p.postedTs * 1000) : null,
            remoteHint: /remote/i.test(p.workLocationOption ?? "") ? true : undefined,
          });
        }
        if (positions.length === 0 || (page + 1) * 10 >= (data?.data?.count ?? 0)) break;
        await sleep(delayMs);
      }
      await sleep(delayMs);
    }
  }
  return [...seen.values()];
}

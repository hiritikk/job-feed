// Netflix runs on Eightfold; the careers page calls /api/apply/v2/jobs (verified 2026-10-27, no auth).
import { toIso } from "../../normalize.js";
import type { Http, RawJob } from "../../types.js";
import { sleep } from "./util.js";

type Position = { id: number; name: string; location?: string; locations?: string[]; t_create?: number; canonicalPositionUrl?: string; job_description?: string };

export async function fetchNetflix(http: Http, opts: { delayMs?: number; maxPages?: number } = {}): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const num = 100;
  for (let page = 0; page < (opts.maxPages ?? 5); page++) {
    const data = await http.json<{ count?: number; positions?: Position[] }>(
      `https://explore.jobs.netflix.net/api/apply/v2/jobs?domain=netflix.com&start=${page * num}&num=${num}`,
    );
    if (!data || !Array.isArray(data.positions)) throw new Error("netflix: response has no positions array");
    for (const p of data.positions) {
      out.push({
        source: "netflix", sourceId: String(p.id), company: "Netflix", title: p.name,
        url: p.canonicalPositionUrl ?? `https://explore.jobs.netflix.net/careers/job/${p.id}`,
        locations: p.locations?.length ? p.locations : p.location ? [p.location] : [],
        postedAt: p.t_create ? toIso(p.t_create * 1000) : null, descriptionHtml: p.job_description,
      });
    }
    if (data.positions.length === 0 || (page + 1) * num >= (data.count ?? 0)) break;
    await sleep(opts.delayMs ?? 1000);
  }
  return out;
}

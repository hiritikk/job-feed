// google.com/about/careers renders results server-side and embeds them in an AF_initDataCallback({key: 'ds:1', ...}) block.
// Layout of one job (verified 2026-10-27): [0] id, [1] title, [3][1] responsibilities html, [4][1] qualifications html,
// [7] company, [9] locations ([[display, [address], city, zip, state, country], ...]), [12] [published seconds, nanos].
import { toIso } from "../../normalize.js";
import type { Http, RawJob } from "../../types.js";
import { BigTechOptions, DEFAULT_LOCATIONS, sleep } from "./util.js";

const PAGE = 20;

function parseResults(html: string): unknown[][] {
  const m = /AF_initDataCallback\(\{key: 'ds:1', hash: '[^']*', data:(.*?), sideChannel/s.exec(html);
  if (!m) throw new Error("google: AF_initDataCallback data block not found (blocked or layout changed)");
  const data = JSON.parse(m[1]) as unknown[];
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error("google: unexpected AF_initDataCallback layout");
  return data[0] as unknown[][];
}

export async function fetchGoogle(http: Http, opts: BigTechOptions = {}): Promise<RawJob[]> {
  const delayMs = opts.delayMs ?? 1000;
  const queries = opts.queries ?? ["software engineer", "software engineer university graduate"];
  const seen = new Map<string, RawJob>();
  for (const location of opts.locations ?? DEFAULT_LOCATIONS) {
    for (const query of queries) {
      for (let page = 1; page <= (opts.maxPages ?? 3); page++) {
        const html = await http.text(
          `https://www.google.com/about/careers/applications/jobs/results/?q=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&sort_by=date` +
            (page > 1 ? `&page=${page}` : ""),
        );
        const jobs = parseResults(html);
        for (const j of jobs) {
          const id = String(j[0]);
          const places = (Array.isArray(j[9]) ? (j[9] as unknown[][]) : []).map((l) => l?.[0]).filter((l): l is string => typeof l === "string");
          const secs = Array.isArray(j[12]) ? (j[12] as number[])[0] : null;
          const part = (v: unknown): string => (Array.isArray(v) && typeof v[1] === "string" ? v[1] : "");
          seen.set(id, {
            source: "google", sourceId: id, company: "Google", title: String(j[1]),
            url: `https://www.google.com/about/careers/applications/jobs/results/${id}`, locations: places,
            postedAt: secs ? toIso(secs * 1000) : null, descriptionHtml: `${part(j[3])} ${part(j[4])}`,
          });
        }
        if (jobs.length < PAGE) break;
        await sleep(delayMs);
      }
      await sleep(delayMs);
    }
  }
  return [...seen.values()];
}

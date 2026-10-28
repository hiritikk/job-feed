import type { CompanyEntry, Http, RawJob } from "../types.js";

type WdPosting = { title: string; externalPath: string; locationsText?: string; postedOn?: string; bulletFields?: string[] };
export type WorkdayOptions = { queries?: string[]; maxPages?: number; now?: Date };

const PAGE = 20;
const DAY = 86_400_000;

/** Workday only exposes relative dates ("Posted 7 Days Ago"); the result is approximate. */
export function parseWorkdayPosted(text: string, now: Date): string {
  const t = text.toLowerCase();
  let days: number | null = null;
  if (/posted today/.test(t)) days = 0;
  else if (/posted yesterday/.test(t)) days = 1;
  else {
    const m = /posted (\d+)\+?\s*days? ago/.exec(t);
    if (m) days = Number(m[1]);
  }
  return days === null ? now.toISOString() : new Date(now.getTime() - days * DAY).toISOString();
}

export async function fetchWorkday(entry: CompanyEntry, http: Http, opts: WorkdayOptions = {}): Promise<RawJob[]> {
  if (!entry.site || entry.wd === undefined) throw new Error(`workday ${entry.slug}: missing site/wd`);
  const queries = opts.queries ?? ["software engineer", "new grad", "university graduate"];
  const maxPages = opts.maxPages ?? 5;
  const now = opts.now ?? new Date();
  const base = `https://${entry.slug}.wd${entry.wd}.myworkdayjobs.com`;
  const seen = new Map<string, RawJob>();

  for (const searchText of queries) {
    let total = Infinity; // Workday only reports `total` on the first page
    for (let page = 0; page < maxPages && page * PAGE < total; page++) {
      const data = await http.json<{ total?: number; jobPostings?: WdPosting[] }>(`${base}/wday/cxs/${entry.slug}/${entry.site}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: PAGE, offset: page * PAGE, searchText }),
      });
      if (!data || !Array.isArray(data.jobPostings)) throw new Error(`workday ${entry.slug}: response has no jobPostings array`);
      if (page === 0) total = data.total ?? data.jobPostings.length;
      if (data.jobPostings.length === 0) break;
      for (const j of data.jobPostings) {
        if (seen.has(j.externalPath)) continue;
        const loc = j.locationsText && !/^\d+\s+locations?$/i.test(j.locationsText) ? [j.locationsText] : [];
        seen.set(j.externalPath, {
          source: "workday",
          sourceId: j.bulletFields?.[0] ?? j.externalPath,
          company: entry.name,
          title: j.title,
          url: `${base}/${entry.site}${j.externalPath}`,
          locations: loc,
          postedAt: parseWorkdayPosted(j.postedOn ?? "", now),
          // "Posted 14 Days Ago" is accurate to the day; "30+" is only a lower bound
          postedPrecision: /posted (today|yesterday|\d+ days? ago)/i.test(j.postedOn ?? "") && !/\+/.test(j.postedOn ?? "") ? "day" : "approx",
        });
      }
    }
  }
  return [...seen.values()];
}

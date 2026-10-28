import { toIso } from "../normalize.js";
import type { Http, RawJob } from "../types.js";

type Env = Record<string, string | undefined>;

export async function fetchAdzuna(http: Http, env: Env): Promise<RawJob[]> {
  const id = env.ADZUNA_APP_ID;
  const key = env.ADZUNA_APP_KEY;
  if (!id || !key) return [];
  type J = { id: string; title: string; company?: { display_name?: string }; location?: { display_name?: string }; redirect_url: string; created?: string; description?: string };
  const out: RawJob[] = [];
  for (let page = 1; page <= 3; page++) {
    const url = `https://api.adzuna.com/v1/api/jobs/ca/search/${page}?app_id=${encodeURIComponent(id)}&app_key=${encodeURIComponent(key)}` +
      `&results_per_page=50&what=${encodeURIComponent("software developer")}&max_days_old=14&sort_by=date`;
    const data = await http.json<{ results?: J[] }>(url);
    if (!data || !Array.isArray(data.results)) throw new Error("adzuna: response has no results array");
    for (const j of data.results) {
      out.push({
        source: "adzuna", sourceId: String(j.id), company: j.company?.display_name ?? "Unknown", title: j.title, url: j.redirect_url,
        locations: j.location?.display_name ? [j.location.display_name] : [], postedAt: toIso(j.created), descriptionHtml: j.description,
      });
    }
    if (data.results.length < 50) break;
  }
  return out;
}

export async function fetchJooble(http: Http, env: Env): Promise<RawJob[]> {
  const key = env.JOOBLE_KEY;
  if (!key) return [];
  type J = { id?: string | number; title: string; location?: string; snippet?: string; link: string; company?: string; updated?: string };
  const data = await http.json<{ jobs?: J[] }>(`https://jooble.org/api/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ keywords: "software developer new grad", location: "Canada", page: "1" }),
  });
  if (!data || !Array.isArray(data.jobs)) throw new Error("jooble: response has no jobs array");
  return data.jobs.map((j) => ({
    source: "jooble", sourceId: String(j.id ?? j.link), company: j.company ?? "Unknown", title: j.title, url: j.link,
    locations: j.location ? [j.location] : [], postedAt: toIso(j.updated), descriptionHtml: j.snippet,
  }));
}

import { toIso, toSnippet } from "../normalize.js";
import type { Http, RawJob } from "../types.js";

/** Parses the first line of an HN "Who is hiring?" comment: "Company | Role | Location" or "Company — Role". */
export function parseHnFirstLine(html: string): { company: string; title: string; firstLine: string } {
  const firstLine = toSnippet(html.split(/<p>|\n/)[0], 400);
  const company = firstLine.split(/\s[|—–]\s|\s\|\s?|\|/)[0].replace(/\(.*?\)/g, "").trim();
  return { company, title: firstLine.slice(0, 120), firstLine };
}

export async function fetchHnHiring(http: Http): Promise<RawJob[]> {
  const search = await http.json<{ hits?: { objectID: string; title: string }[] }>(
    "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5",
  );
  const thread = search?.hits?.find((h) => /who is hiring\?/i.test(h.title));
  if (!thread) throw new Error("hn: no 'Who is hiring?' thread found");
  const items = await http.json<{ children?: { id: number; text?: string | null; created_at?: string }[] }>(
    `https://hn.algolia.com/api/v1/items/${thread.objectID}`,
  );
  if (!Array.isArray(items?.children)) throw new Error("hn: thread has no children");
  const out: RawJob[] = [];
  for (const c of items.children) {
    if (!c.text) continue;
    const { company, title, firstLine } = parseHnFirstLine(c.text);
    if (!company) continue;
    out.push({
      source: "hn", sourceId: String(c.id), company, title, url: `https://news.ycombinator.com/item?id=${c.id}`,
      locations: [firstLine], postedAt: toIso(c.created_at), descriptionHtml: c.text,
    });
  }
  return out;
}

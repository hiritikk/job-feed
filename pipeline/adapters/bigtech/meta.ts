// Meta publishes its postings in a sitemap named in robots.txt (https://www.metacareers.com/jobsearch/sitemap.xml); every
// job page carries schema.org JobPosting data (title, datePosted with timezone, jobLocation). No browser or API is needed.
// Job pages are heavy (~350 KB), so only pages not seen on an earlier run are fetched; known jobs still listed in the sitemap
// are re-emitted from the previous run so they stay confirmed.
import { toIso } from "../../normalize.js";
import type { Http, RawJob } from "../../types.js";
import { sleep } from "./util.js";

const SITEMAP = "https://www.metacareers.com/jobsearch/sitemap.xml";
const jobUrl = (id: string): string => `https://www.metacareers.com/profile/job_details/${id}/`;

type Place = { name?: string; address?: { addressLocality?: string; addressCountry?: string } };
type Posting = {
  "@type"?: string; title?: string; description?: string; responsibilities?: string; qualifications?: string;
  datePosted?: string; jobLocation?: Place | Place[];
};

function parsePosting(html: string): Posting | null {
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)) {
    try {
      const data = JSON.parse(m[1]) as Posting | Posting[];
      const found = (Array.isArray(data) ? data : [data]).find((d) => d["@type"] === "JobPosting");
      if (found) return found;
    } catch {
      // not valid JSON: try the next block
    }
  }
  return null;
}

const COUNTRY: Record<string, string> = { CA: "Canada" };

function locationsOf(p: Posting): string[] {
  const places = Array.isArray(p.jobLocation) ? p.jobLocation : p.jobLocation ? [p.jobLocation] : [];
  return places
    .map((l) => {
      const name = l.name ?? l.address?.addressLocality ?? "";
      const country = l.address?.addressCountry ? COUNTRY[l.address.addressCountry] ?? l.address.addressCountry : "";
      return [name, country].filter(Boolean).join(", ");
    })
    .filter(Boolean);
}

export type MetaOptions = { delayMs?: number; maxNew?: number; known?: Map<string, RawJob> };

export async function fetchMeta(http: Http, opts: MetaOptions = {}): Promise<RawJob[]> {
  const sitemap = await http.text(SITEMAP);
  const ids = [...new Set([...sitemap.matchAll(/job_details\/(\d+)\//g)].map((m) => m[1]))];
  if (ids.length === 0) throw new Error("meta: sitemap has no job urls (blocked or layout changed)");

  const known = opts.known ?? new Map<string, RawJob>();
  const delayMs = opts.delayMs ?? 1000;
  let fetched = 0;
  const out: RawJob[] = [];
  for (const id of ids) {
    const before = known.get(id);
    if (before) {
      out.push(before);
      continue;
    }
    if (fetched >= (opts.maxNew ?? 150)) continue;
    fetched++;
    try {
      const posting = parsePosting(await http.text(jobUrl(id)));
      if (posting?.title) {
        const locations = locationsOf(posting);
        out.push({
          source: "meta", sourceId: id, company: "Meta", title: posting.title, url: jobUrl(id), locations,
          postedAt: toIso(posting.datePosted),
          descriptionHtml: [posting.description, posting.responsibilities, posting.qualifications].filter(Boolean).join(" "),
          remoteHint: locations.some((l) => /remote/i.test(l)) ? true : undefined,
        });
      }
    } catch {
      // one broken page must not lose the others; it is retried next run
    }
    await sleep(delayMs);
  }
  return out;
}

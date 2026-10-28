import { toIso } from "../normalize.js";
import type { Http, RawJob } from "../types.js";

const requireArray = <T>(value: unknown, what: string): T[] => {
  if (!Array.isArray(value)) throw new Error(`${what}: response has no jobs array`);
  return value as T[];
};

export async function fetchRemotive(http: Http): Promise<RawJob[]> {
  type J = { id: number; url: string; title: string; company_name: string; publication_date?: string; candidate_required_location?: string; description?: string };
  const data = await http.json<{ jobs?: J[] }>("https://remotive.com/api/remote-jobs?category=software-dev&limit=200");
  return requireArray<J>(data?.jobs, "remotive").map((j) => ({
    source: "remotive", sourceId: String(j.id), company: j.company_name, title: j.title, url: j.url,
    locations: j.candidate_required_location ? [j.candidate_required_location] : [],
    postedAt: toIso(j.publication_date), descriptionHtml: j.description, remoteHint: true,
  }));
}

export async function fetchRemoteOk(http: Http): Promise<RawJob[]> {
  type J = { id?: string; url: string; position: string; company: string; epoch?: number; date?: string; location?: string; description?: string };
  const data = await http.json<J[]>("https://remoteok.com/api");
  // Element 0 is a legal notice, not a job.
  return requireArray<J>(data, "remoteok").filter((j) => j.id && j.position).map((j) => ({
    source: "remoteok", sourceId: String(j.id), company: j.company, title: j.position, url: j.url,
    locations: j.location ? [j.location] : [], postedAt: j.epoch ? toIso(j.epoch * 1000) : toIso(j.date),
    descriptionHtml: j.description, remoteHint: true,
  }));
}

export async function fetchJobicy(http: Http): Promise<RawJob[]> {
  type J = { id: number; url: string; jobTitle: string; companyName: string; jobGeo?: string; pubDate?: string; jobDescription?: string };
  const data = await http.json<{ jobs?: J[] }>("https://jobicy.com/api/v2/remote-jobs?count=100&industry=dev");
  return requireArray<J>(data?.jobs, "jobicy").map((j) => ({
    source: "jobicy", sourceId: String(j.id), company: j.companyName, title: j.jobTitle, url: j.url,
    locations: j.jobGeo ? [j.jobGeo] : [], postedAt: toIso(j.pubDate), descriptionHtml: j.jobDescription, remoteHint: true,
  }));
}

export async function fetchHimalayas(http: Http): Promise<RawJob[]> {
  type J = { guid?: string; applicationLink?: string; title: string; companyName: string; locationRestrictions?: string[]; pubDate?: number; description?: string };
  const out: RawJob[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 5; page++) {
    const url: string = `https://himalayas.app/jobs/api?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const data: { jobs?: J[]; nextCursor?: string | null } = await http.json(url);
    for (const j of requireArray<J>(data?.jobs, "himalayas")) {
      const link = j.guid ?? j.applicationLink ?? "";
      out.push({
        source: "himalayas", sourceId: link, company: j.companyName, title: j.title, url: link,
        locations: j.locationRestrictions ?? [], postedAt: j.pubDate ? toIso(j.pubDate * 1000) : null,
        descriptionHtml: j.description, remoteHint: true,
      });
    }
    cursor = data.nextCursor ?? null;
    if (!cursor) break;
  }
  return out;
}

export async function fetchArbeitnow(http: Http): Promise<RawJob[]> {
  type J = { slug: string; company_name: string; title: string; description?: string; remote?: boolean; url: string; location?: string; created_at?: number };
  const data = await http.json<{ data?: J[] }>("https://www.arbeitnow.com/api/job-board-api");
  return requireArray<J>(data?.data, "arbeitnow").map((j) => ({
    source: "arbeitnow", sourceId: j.slug, company: j.company_name, title: j.title, url: j.url,
    locations: j.location ? [j.location] : [], postedAt: j.created_at ? toIso(j.created_at * 1000) : null,
    descriptionHtml: j.description, remoteHint: j.remote ? true : undefined,
  }));
}

export async function fetchTheMuse(http: Http): Promise<RawJob[]> {
  type J = { id: number; name: string; company: { name: string }; locations?: { name: string }[]; refs: { landing_page: string }; publication_date?: string; contents?: string };
  const out: RawJob[] = [];
  for (let page = 1; page <= 5; page++) {
    const data = await http.json<{ page_count?: number; results?: J[] }>(
      `https://www.themuse.com/api/public/jobs?category=Software%20Engineering&level=Entry%20Level&page=${page}`,
    );
    for (const j of requireArray<J>(data?.results, "themuse")) {
      out.push({
        source: "themuse", sourceId: String(j.id), company: j.company.name, title: j.name, url: j.refs.landing_page,
        locations: (j.locations ?? []).map((l) => l.name), postedAt: toIso(j.publication_date), descriptionHtml: j.contents,
        remoteHint: (j.locations ?? []).some((l) => /flexible|remote/i.test(l.name)) ? true : undefined,
      });
    }
    if (page >= (data.page_count ?? 1)) break;
  }
  return out;
}

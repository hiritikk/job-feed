import type { CompanyEntry, Http, RawJob } from "../types.js";

type BambooJob = {
  id: string; jobOpeningName: string; isRemote?: boolean | null;
  location?: { city?: string | null; state?: string | null };
  atsLocation?: { country?: string | null; state?: string | null; province?: string | null; city?: string | null };
};

/** BambooHR's public careers list has no posting dates, so postedAt stays null (the site shows when we first found the job). */
export async function fetchBambooHr(entry: CompanyEntry, http: Http): Promise<RawJob[]> {
  const data = await http.json<{ result?: BambooJob[] }>(`https://${entry.slug}.bamboohr.com/careers/list`);
  if (!data || !Array.isArray(data.result)) throw new Error(`bamboohr ${entry.slug}: response has no result array`);
  return data.result.map((j) => {
    const ats = j.atsLocation ?? {};
    const place = [j.location?.city ?? ats.city, j.location?.state ?? ats.province ?? ats.state, ats.country].filter(Boolean).join(", ");
    return {
      source: "bamboohr", sourceId: String(j.id), company: entry.name, title: j.jobOpeningName.trim(),
      url: `https://${entry.slug}.bamboohr.com/careers/${j.id}`, locations: place ? [place] : [], postedAt: null,
      remoteHint: j.isRemote ? true : undefined,
    };
  });
}

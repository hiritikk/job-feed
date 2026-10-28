// Oracle's own careers site runs on Oracle Cloud HCM; the REST endpoint below is what the page calls (verified 2026-10-27).
import { toIso } from "../../normalize.js";
import type { Http, RawJob } from "../../types.js";
import { sleep } from "./util.js";

const HOST = "https://eeho.fa.us2.oraclecloud.com";
const SITE = "CX_45001";
const LIMIT = 50;

type Req = { Id: string; Title: string; PostedDate?: string; PrimaryLocation?: string; WorkplaceType?: string; ShortDescriptionStr?: string };

export async function fetchOracle(http: Http, opts: { delayMs?: number; maxPages?: number } = {}): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (let page = 0; page < (opts.maxPages ?? 4); page++) {
    const data = await http.json<{ items?: { TotalJobsCount?: number; requisitionList?: Req[] | null }[] }>(
      `${HOST}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${SITE},limit=${LIMIT},offset=${page * LIMIT},sortBy=POSTING_DATES_DESC`,
    );
    const list = data?.items?.[0]?.requisitionList;
    if (!Array.isArray(list)) throw new Error("oracle: response has no requisitionList array");
    for (const r of list) {
      out.push({
        source: "oracle", sourceId: r.Id, company: "Oracle", title: r.Title,
        url: `${HOST}/hcmUI/CandidateExperience/en/sites/${SITE}/job/${r.Id}`,
        locations: r.PrimaryLocation ? [r.PrimaryLocation] : [], postedAt: toIso(r.PostedDate),
        postedPrecision: "day", descriptionHtml: r.ShortDescriptionStr, remoteHint: /remote/i.test(r.WorkplaceType ?? "") ? true : undefined,
      });
    }
    if (list.length < LIMIT || (page + 1) * LIMIT >= (data.items?.[0]?.TotalJobsCount ?? 0)) break;
    await sleep(opts.delayMs ?? 1000);
  }
  return out;
}

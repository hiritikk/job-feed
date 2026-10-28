import type { CompanyEntry, Http, RawJob } from "../types.js";
import { fetchAshby } from "./ashby.js";
import { fetchGreenhouse } from "./greenhouse.js";
import { fetchLever } from "./lever.js";
import { fetchSmartRecruiters } from "./smartrecruiters.js";
import { fetchWorkable } from "./workable.js";
import { fetchWorkday } from "./workday.js";

export type AtsFetcher = (entry: CompanyEntry, http: Http) => Promise<RawJob[]>;

/** One fetcher per company-board ATS; "custom" employers are served by the bespoke adapters in ./bigtech. */
export const ATS_FETCHERS = {
  greenhouse: fetchGreenhouse, lever: fetchLever, ashby: fetchAshby, workday: fetchWorkday,
  workable: fetchWorkable, smartrecruiters: fetchSmartRecruiters,
} as const satisfies Record<string, AtsFetcher>;

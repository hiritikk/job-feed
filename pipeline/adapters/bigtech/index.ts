import type { Http, RawJob } from "../../types.js";
import { fetchMeta } from "./meta.js";
import { fetchAmazon } from "./amazon.js";
import { fetchGoogle } from "./google.js";
import { fetchMicrosoft } from "./microsoft.js";
import { fetchNetflix } from "./netflix.js";
import { fetchOracle } from "./oracle.js";

/** One entry per career site so each is its own source with its own health (spec §3.1b). */
/** `knownMeta`: Meta jobs from the previous run, keyed by Meta job id (so unchanged pages are not downloaded again). */
export function bigTechAdapters(http: Http, knownMeta?: Map<string, RawJob>): Record<string, () => Promise<RawJob[]>> {
  return {
    amazon: () => fetchAmazon(http),
    google: () => fetchGoogle(http),
    meta: () => fetchMeta(http, { known: knownMeta }),
    microsoft: () => fetchMicrosoft(http),
    netflix: () => fetchNetflix(http),
    oracle: () => fetchOracle(http),
  };
}

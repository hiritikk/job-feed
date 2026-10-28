import type { Http, RawJob } from "../../types.js";
import { fetchAmazon } from "./amazon.js";
import { fetchGoogle } from "./google.js";
import { fetchMicrosoft } from "./microsoft.js";
import { fetchNetflix } from "./netflix.js";
import { fetchOracle } from "./oracle.js";

/** One entry per career site so each is its own source with its own health (spec §3.1b). */
export function bigTechAdapters(http: Http): Record<string, () => Promise<RawJob[]>> {
  return {
    amazon: () => fetchAmazon(http),
    google: () => fetchGoogle(http),
    microsoft: () => fetchMicrosoft(http),
    netflix: () => fetchNetflix(http),
    oracle: () => fetchOracle(http),
  };
}

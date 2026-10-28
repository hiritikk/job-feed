// Weekly live check (never blocks): one real request per ATS family and per big-tech site, to catch upstream format changes early.
import { ATS_FETCHERS } from "../pipeline/adapters/ats.js";
import { fetchAmazon } from "../pipeline/adapters/bigtech/amazon.js";
import { fetchGoogle } from "../pipeline/adapters/bigtech/google.js";
import { fetchMicrosoft } from "../pipeline/adapters/bigtech/microsoft.js";
import { fetchNetflix } from "../pipeline/adapters/bigtech/netflix.js";
import { fetchOracle } from "../pipeline/adapters/bigtech/oracle.js";
import { communityAdapters } from "../pipeline/adapters/communityLists.js";
import { loadCompanies } from "../pipeline/config.js";
import { createHttp } from "../pipeline/http.js";

const http = createHttp();
const one = { delayMs: 0, queries: ["software engineer"], locations: ["Canada"], maxPages: 1 };
const checks: [string, () => Promise<unknown[]>][] = [];

const companies = loadCompanies();
for (const [ats, fetcher] of Object.entries(ATS_FETCHERS)) {
  const entry = companies.find((c) => c.ats === ats);
  if (entry) checks.push([`${ats} (${entry.name})`, () => fetcher(entry, http)]);
}
checks.push(["amazon", () => fetchAmazon(http, one)], ["google", () => fetchGoogle(http, { ...one, queries: ["software engineer"] })]);
checks.push(["microsoft", () => fetchMicrosoft(http, one)], ["netflix", () => fetchNetflix(http, { delayMs: 0, maxPages: 1 })], ["oracle", () => fetchOracle(http, { delayMs: 0, maxPages: 1 })]);
for (const [name, fn] of Object.entries(communityAdapters(http))) checks.push([name, fn]);

let broken = 0;
for (const [name, run] of checks) {
  try {
    const jobs = await run();
    if (jobs.length === 0) throw new Error("returned zero jobs");
    console.log(`ok    ${name}: ${jobs.length} jobs`);
  } catch (err) {
    broken++;
    console.log(`::warning title=Smoke test failed: ${name}::${(err as Error).message}`);
  }
}
console.log(`${checks.length - broken}/${checks.length} sources parse correctly`);

import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fetchAmazon } from "../pipeline/adapters/bigtech/amazon.js";
import { fetchNetflix } from "../pipeline/adapters/bigtech/netflix.js";
import { fetchMicrosoft } from "../pipeline/adapters/bigtech/microsoft.js";
import { fetchGoogle } from "../pipeline/adapters/bigtech/google.js";
import { fetchOracle } from "../pipeline/adapters/bigtech/oracle.js";
import { fetchMeta } from "../pipeline/adapters/bigtech/meta.js";
import type { RawJob } from "../pipeline/types.js";
import { bigTechAdapters } from "../pipeline/adapters/bigtech/index.js";
import type { Http } from "../pipeline/types.js";

const fx = (name: string) => JSON.parse(readFileSync(`tests/fixtures/${name}.json`, "utf8"));
const fixed = (body: unknown): Http & { urls: string[] } => {
  const urls: string[] = [];
  return { urls, json: async (u: string) => (urls.push(u), body as never), text: async (u: string) => (urls.push(u), body as never) };
};
const google = readFileSync("tests/fixtures/google.html", "utf8");
const opts = { delayMs: 0, queries: ["software engineer"], locations: ["Canada"], maxPages: 1 };

describe("fetchAmazon", () => {
  const data = fx("amazon");
  test("maps jobs, builds absolute urls, converts 3-letter country codes", async () => {
    const jobs = await fetchAmazon(fixed({ ...data, hits: 5 }), opts);
    expect(jobs).toHaveLength(5);
    expect(jobs[0]).toMatchObject({
      source: "amazon", company: "Amazon", sourceId: data.jobs[0].id_icims, title: data.jobs[0].title,
      url: `https://www.amazon.jobs${data.jobs[0].job_path}`, postedPrecision: "day",
    });
    expect(jobs[0].postedAt).toBe(new Date(`${data.jobs[0].posted_date} UTC`).toISOString());
    expect(jobs.find((j) => j.locations.join().includes("CAN"))).toBeUndefined(); // "CAN" is replaced by "Canada"
  });
  test("builds the documented query url", async () => {
    const http = fixed({ ...data, hits: 5 });
    await fetchAmazon(http, opts);
    expect(http.urls[0]).toContain("https://www.amazon.jobs/en/search.json?");
    expect(http.urls[0]).toContain("base_query=software%20engineer");
    expect(http.urls[0]).toContain("loc_query=Canada");
    expect(http.urls[0]).toContain("sort=recent");
  });
  test("an error payload throws", async () => {
    await expect(fetchAmazon(fixed({ error: "x" }), opts)).rejects.toThrow(/jobs/);
  });
});

describe("fetchNetflix", () => {
  const data = fx("netflix");
  test("maps Eightfold positions", async () => {
    const jobs = await fetchNetflix(fixed({ ...data, count: 5 }), { delayMs: 0, maxPages: 1 });
    expect(jobs).toHaveLength(5);
    expect(jobs[0]).toMatchObject({ source: "netflix", company: "Netflix", title: data.positions[0].name, url: data.positions[0].canonicalPositionUrl, locations: data.positions[0].locations });
    expect(jobs[0].postedAt).toBe(new Date(data.positions[0].t_create * 1000).toISOString());
  });
  test("an error payload throws", async () => {
    await expect(fetchNetflix(fixed({ message: "x" }), { delayMs: 0, maxPages: 1 })).rejects.toThrow(/positions/);
  });
});

describe("fetchMicrosoft", () => {
  const data = fx("microsoft");
  test("maps pcsx positions with absolute urls and epoch dates", async () => {
    const http = fixed(data);
    const jobs = await fetchMicrosoft(http, opts);
    expect(http.urls[0]).toContain("https://apply.careers.microsoft.com/api/pcsx/search?");
    expect(http.urls[0]).toContain("location=Canada");
    expect(jobs).toHaveLength(5);
    expect(jobs[0]).toMatchObject({
      source: "microsoft", company: "Microsoft", sourceId: String(data.data.positions[0].id), title: data.data.positions[0].name,
      url: `https://apply.careers.microsoft.com${data.data.positions[0].positionUrl}`, locations: data.data.positions[0].locations,
    });
    expect(jobs[0].postedAt).toBe(new Date(data.data.positions[0].postedTs * 1000).toISOString());
  });
  test("fetches only the newest page per query by default (page 2 is blocked for scripted clients and is not worked around)", async () => {
    const http = fixed({ ...data, data: { ...data.data, count: 40 } });
    await fetchMicrosoft(http, { delayMs: 0, queries: ["software engineer"], locations: ["Canada"] });
    expect(http.urls).toHaveLength(1);
    expect(http.urls[0]).toContain("start=0");
  });
  test("a rate limit mid-run returns what was collected instead of failing the whole source", async () => {
    let n = 0;
    const http: Http = {
      json: async () => { if (n++ === 0) return data as never; throw new Error("HTTP 429 https://apply.careers.microsoft.com/api/pcsx/search"); },
      text: async () => "",
    };
    const jobs = await fetchMicrosoft(http, { delayMs: 0, queries: ["a", "b", "c"], locations: ["Canada"] });
    expect(jobs).toHaveLength(5);
  });
  test("a rate limit on the very first request still throws", async () => {
    const http: Http = { json: async () => { throw new Error("HTTP 429 x"); }, text: async () => "" };
    await expect(fetchMicrosoft(http, { delayMs: 0, queries: ["a"], locations: ["Canada"] })).rejects.toThrow(/429/);
  });
  test("an error payload throws", async () => {
    await expect(fetchMicrosoft(fixed({ status: 500, data: null }), opts)).rejects.toThrow(/positions/);
  });
});

describe("fetchGoogle", () => {
  test("parses the embedded AF_initDataCallback data", async () => {
    const http = fixed(google);
    const jobs = await fetchGoogle(http, opts);
    expect(http.urls[0]).toContain("https://www.google.com/about/careers/applications/jobs/results/?");
    expect(jobs).toHaveLength(4);
    expect(jobs[0]).toMatchObject({ source: "google", company: "Google", sourceId: "120417534544356038", title: "Data Center Technician" });
    expect(jobs[0].url).toBe("https://www.google.com/about/careers/applications/jobs/results/120417534544356038");
    expect(jobs[0].locations[0]).toContain("Toronto");
    expect(jobs[0].postedAt).toBe(new Date(1793119312 * 1000).toISOString());
  });
  test("HTML without the data block throws", async () => {
    await expect(fetchGoogle(fixed("<html>captcha</html>"), opts)).rejects.toThrow(/AF_initDataCallback/);
  });
});

describe("fetchOracle", () => {
  const data = fx("oracle");
  test("maps requisitions with absolute urls", async () => {
    const jobs = await fetchOracle(fixed(data), { delayMs: 0, maxPages: 1 });
    const r = data.items[0].requisitionList[0];
    expect(jobs).toHaveLength(5);
    expect(jobs[0]).toMatchObject({
      source: "oracle", company: "Oracle", sourceId: r.Id, title: r.Title, locations: [r.PrimaryLocation],
      url: `https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_45001/job/${r.Id}`,
      postedAt: "2026-10-28T00:00:00.000Z", postedPrecision: "day",
    });
  });
  test("requests the secondaryLocations expansion (without it Oracle omits requisitionList)", async () => {
    const http = fixed(data);
    await fetchOracle(http, { delayMs: 0, maxPages: 1 });
    expect(http.urls[0]).toContain("expand=requisitionList.secondaryLocations");
    expect(http.urls[0]).toContain("siteNumber=CX_45001");
  });
  test("a payload without requisitionList throws", async () => {
    await expect(fetchOracle(fixed({ items: [{ requisitionList: null }] }), { delayMs: 0, maxPages: 1 })).rejects.toThrow(/requisitionList/);
  });
});

describe("fetchMeta (sitemap + JobPosting structured data)", () => {
  const sitemap = readFileSync("tests/fixtures/meta-sitemap.xml", "utf8");
  const page = readFileSync("tests/fixtures/meta-job.html", "utf8");
  const ids = [...sitemap.matchAll(/job_details\/(\d+)\//g)].map((m) => m[1]);
  const serve = () => {
    const urls: string[] = [];
    const http: Http = { json: async () => ({}) as never, text: async (u: string) => (urls.push(u), u.endsWith("sitemap.xml") ? sitemap : page) };
    return { http, urls };
  };
  test("reads the sitemap, then each unseen job page, and maps the structured data", async () => {
    const { http, urls } = serve();
    const jobs = await fetchMeta(http, { delayMs: 0, maxNew: 10 });
    expect(urls[0]).toBe("https://www.metacareers.com/jobsearch/sitemap.xml");
    expect(urls).toHaveLength(1 + ids.length);
    expect(jobs).toHaveLength(ids.length);
    expect(jobs[0]).toMatchObject({
      source: "meta", company: "Meta", title: "ASIC Verification Engineer, Networking", sourceId: ids[0],
      url: `https://www.metacareers.com/profile/job_details/${ids[0]}/`, locations: ["Sunnyvale, CA, US"], postedAt: "2026-10-27T23:20:27.000Z",
    });
  });
  test("known jobs are not refetched but are re-emitted from the previous run, so they stay confirmed", async () => {
    const { http, urls } = serve();
    const known = new Map<string, RawJob>([[ids[0], { source: "meta", sourceId: ids[0], company: "Meta", title: "Old title", url: `https://www.metacareers.com/profile/job_details/${ids[0]}/`, locations: ["Menlo Park, CA, US"], postedAt: "2026-10-01T00:00:00.000Z" }]]);
    const jobs = await fetchMeta(http, { delayMs: 0, maxNew: 10, known });
    expect(urls).toHaveLength(ids.length); // sitemap + all but the known one
    expect(jobs).toHaveLength(ids.length);
    expect(jobs.find((j) => j.sourceId === ids[0])!.title).toBe("Old title");
  });
  test("known jobs that left the sitemap are not re-emitted", async () => {
    const { http } = serve();
    const gone: RawJob = { source: "meta", sourceId: "999", company: "Meta", title: "Gone", url: "https://www.metacareers.com/profile/job_details/999/", locations: [], postedAt: null };
    const jobs = await fetchMeta(http, { delayMs: 0, maxNew: 10, known: new Map([["999", gone]]) });
    expect(jobs.some((j) => j.sourceId === "999")).toBe(false);
  });
  test("at most maxNew new pages are fetched per run", async () => {
    const { http, urls } = serve();
    await fetchMeta(http, { delayMs: 0, maxNew: 2 });
    expect(urls).toHaveLength(1 + 2);
  });
  test("a page without structured data is skipped, an empty sitemap throws", async () => {
    const http: Http = { json: async () => ({}) as never, text: async (u: string) => (u.endsWith("sitemap.xml") ? sitemap : "<html>blocked</html>") };
    expect(await fetchMeta(http, { delayMs: 0, maxNew: 10 })).toEqual([]);
    await expect(fetchMeta({ json: async () => ({}) as never, text: async () => "<html>nope</html>" }, { delayMs: 0 })).rejects.toThrow(/sitemap/);
  });
});

describe("bigTechAdapters", () => {
  test("exposes one adapter per big-tech source", () => {
    expect(Object.keys(bigTechAdapters(fixed({}))).sort()).toEqual(["amazon", "google", "meta", "microsoft", "netflix", "oracle"]);
  });
});

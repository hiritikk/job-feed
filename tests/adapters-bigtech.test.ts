import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fetchAmazon } from "../pipeline/adapters/bigtech/amazon.js";
import { fetchNetflix } from "../pipeline/adapters/bigtech/netflix.js";
import { fetchMicrosoft } from "../pipeline/adapters/bigtech/microsoft.js";
import { fetchGoogle } from "../pipeline/adapters/bigtech/google.js";
import { fetchOracle } from "../pipeline/adapters/bigtech/oracle.js";
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
      url: `https://www.amazon.jobs${data.jobs[0].job_path}`, postedApprox: true,
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
      postedAt: "2026-10-28T00:00:00.000Z",
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

describe("bigTechAdapters", () => {
  test("exposes one adapter per big-tech source", () => {
    expect(Object.keys(bigTechAdapters(fixed({}))).sort()).toEqual(["amazon", "google", "microsoft", "netflix", "oracle"]);
  });
});

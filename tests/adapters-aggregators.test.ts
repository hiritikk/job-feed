import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  fetchArbeitnow, fetchHimalayas, fetchJobicy, fetchRemoteOk, fetchRemotive, fetchTheMuse,
} from "../pipeline/adapters/aggregators.js";
import { fetchHnHiring, parseHnFirstLine } from "../pipeline/adapters/hn.js";
import { fetchAdzuna, fetchJooble } from "../pipeline/adapters/keyed.js";
import type { Http } from "../pipeline/types.js";

const fx = (name: string) => JSON.parse(readFileSync(`tests/fixtures/${name}.json`, "utf8"));
const route = (handler: (url: string, init?: RequestInit) => unknown): Http & { urls: string[] } => {
  const urls: string[] = [];
  return { urls, json: async (u: string, i?: RequestInit) => (urls.push(u), handler(u, i) as never), text: async () => "" };
};
const fixed = (body: unknown) => route(() => body);

describe("fetchRemotive", () => {
  test("maps jobs as remote with UTC dates", async () => {
    const data = fx("remotive");
    const http = fixed(data);
    const jobs = await fetchRemotive(http);
    expect(http.urls[0]).toContain("remotive.com/api/remote-jobs?category=software-dev");
    expect(jobs).toHaveLength(5);
    expect(jobs[0]).toMatchObject({
      source: "remotive", sourceId: String(data.jobs[0].id), company: data.jobs[0].company_name, title: data.jobs[0].title,
      url: data.jobs[0].url, locations: [data.jobs[0].candidate_required_location], remoteHint: true,
      postedAt: `${data.jobs[0].publication_date}.000Z`,
    });
  });
  test("payload without jobs throws", async () => {
    await expect(fetchRemotive(fixed({ message: "x" }))).rejects.toThrow(/jobs/);
  });
});

describe("fetchRemoteOk", () => {
  test("ignores the legal-notice first element", async () => {
    const data = fx("remoteok");
    expect(data[0].id).toBeUndefined();
    const jobs = await fetchRemoteOk(fixed(data));
    expect(jobs).toHaveLength(data.length - 1);
    expect(jobs[0]).toMatchObject({ source: "remoteok", title: data[1].position, company: data[1].company, remoteHint: true });
    expect(jobs[0].postedAt).toBe(new Date(data[1].epoch * 1000).toISOString());
  });
});

describe("fetchJobicy", () => {
  test("maps jobGeo to locations", async () => {
    const data = fx("jobicy");
    const jobs = await fetchJobicy(fixed(data));
    expect(jobs).toHaveLength(5);
    expect(jobs[0]).toMatchObject({ source: "jobicy", title: data.jobs[0].jobTitle, company: data.jobs[0].companyName, remoteHint: true });
    expect(jobs[0].locations).toEqual([data.jobs[0].jobGeo]);
  });
});

describe("fetchHimalayas", () => {
  test("follows nextCursor once then stops when it is null", async () => {
    const page1 = fx("himalayas");
    const page2 = { jobs: [], nextCursor: null };
    const http = route((u) => (u.includes("cursor=") ? page2 : page1));
    const jobs = await fetchHimalayas(http);
    expect(http.urls).toHaveLength(2);
    expect(http.urls[1]).toContain(`cursor=${encodeURIComponent(page1.nextCursor)}`);
    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toMatchObject({ source: "himalayas", company: page1.jobs[0].companyName, remoteHint: true });
    expect(jobs[0].postedAt).toBe(new Date(page1.jobs[0].pubDate * 1000).toISOString());
  });
});

describe("fetchArbeitnow", () => {
  test("maps jobs; epoch seconds to ISO", async () => {
    const data = fx("arbeitnow");
    const jobs = await fetchArbeitnow(fixed(data));
    expect(jobs).toHaveLength(5);
    expect(jobs[0]).toMatchObject({ source: "arbeitnow", sourceId: data.data[0].slug, url: data.data[0].url, locations: [data.data[0].location] });
    expect(jobs[0].postedAt).toBe(new Date(data.data[0].created_at * 1000).toISOString());
  });
});

describe("fetchTheMuse", () => {
  test("requests entry level software engineering and stops at page_count", async () => {
    const data = fx("themuse");
    const http = route(() => ({ ...data, page_count: 1 }));
    const jobs = await fetchTheMuse(http);
    expect(http.urls).toHaveLength(1);
    expect(http.urls[0]).toContain("category=Software%20Engineering");
    expect(http.urls[0]).toContain("level=Entry%20Level");
    expect(jobs[0]).toMatchObject({ source: "themuse", company: data.results[0].company.name, title: data.results[0].name, url: data.results[0].refs.landing_page });
  });
});

describe("HN Who is hiring", () => {
  test("parses 'Company | Role | Location' first lines", () => {
    expect(parseHnFirstLine("Stripe | Software Engineer | Toronto, ON | Remote<p>We build...")).toEqual({
      company: "Stripe", title: "Stripe | Software Engineer | Toronto, ON | Remote", firstLine: "Stripe | Software Engineer | Toronto, ON | Remote",
    });
  });
  test("parses 'Company (note) — Role' first lines and decodes entities", () => {
    const r = parseHnFirstLine("PrairieLearn (Remote US) — Full-Stack Software Engineer &#x2F; AI<p>x");
    expect(r.company).toBe("PrairieLearn");
    expect(r.title).toContain("Full-Stack Software Engineer / AI");
  });
  test("finds the latest hiring thread, uses top-level comments only", async () => {
    const threads = fx("hn_threads");
    const thread = fx("hn_thread");
    const http = route((u) => (u.includes("search_by_date") ? threads : thread));
    const jobs = await fetchHnHiring(http);
    expect(http.urls[1]).toBe("https://hn.algolia.com/api/v1/items/49922569");
    expect(jobs).toHaveLength(thread.children.length);
    expect(jobs[0]).toMatchObject({ source: "hn", url: `https://news.ycombinator.com/item?id=${thread.children[0].id}` });
    expect(jobs[0].title.length).toBeLessThanOrEqual(120);
  });
  test("no hiring thread found throws", async () => {
    await expect(fetchHnHiring(route(() => ({ hits: [] })))).rejects.toThrow(/thread/);
  });
});

describe("keyed aggregators", () => {
  test("Adzuna and Jooble return [] with no HTTP calls when keys are absent", async () => {
    const http = fixed({});
    expect(await fetchAdzuna(http, {})).toEqual([]);
    expect(await fetchJooble(http, {})).toEqual([]);
    expect(http.urls).toHaveLength(0);
  });
  test("Adzuna maps results when keys are present", async () => {
    const http = route(() => ({ results: [{ id: "1", title: "Software Developer", company: { display_name: "Acme" }, location: { display_name: "Toronto, Ontario" }, redirect_url: "https://a.test/1", created: "2026-10-26T10:00:00Z", description: "<b>Build</b>" }] }));
    const jobs = await fetchAdzuna(http, { ADZUNA_APP_ID: "id", ADZUNA_APP_KEY: "key" });
    expect(http.urls[0]).toContain("/jobs/ca/search/1");
    expect(http.urls[0]).toContain("app_id=id");
    expect(jobs[0]).toMatchObject({ source: "adzuna", company: "Acme", title: "Software Developer", locations: ["Toronto, Ontario"], url: "https://a.test/1" });
  });
});

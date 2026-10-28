import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fetchGreenhouse } from "../pipeline/adapters/greenhouse.js";
import { fetchLever } from "../pipeline/adapters/lever.js";
import { fetchAshby } from "../pipeline/adapters/ashby.js";
import type { CompanyEntry, Http } from "../pipeline/types.js";

const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/${name}.json`, "utf8"));
const httpReturning = (body: unknown): Http & { urls: string[] } => {
  const urls: string[] = [];
  return { urls, json: async (u: string) => (urls.push(u), body as never), text: async () => "" };
};
const entry = (name: string, ats: CompanyEntry["ats"], slug: string): CompanyEntry => ({ name, ats, slug, tier: 1 });

describe("fetchGreenhouse", () => {
  const gh = fixture("greenhouse");
  test("maps jobs", async () => {
    const http = httpReturning(gh);
    const jobs = await fetchGreenhouse(entry("Stripe", "greenhouse", "stripe"), http);
    expect(http.urls[0]).toBe("https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true");
    expect(jobs).toHaveLength(5);
    expect(jobs[0]).toMatchObject({
      source: "greenhouse", company: "Stripe", sourceId: String(gh.jobs[0].id), url: gh.jobs[0].absolute_url,
      locations: [gh.jobs[0].location.name], postedAt: new Date(gh.jobs[0].first_published).toISOString(),
    });
    expect(typeof jobs[0].descriptionHtml).toBe("string");
  });
  test("a job without location yields []", async () => {
    const mutated = { jobs: [{ ...gh.jobs[0], location: null }] };
    expect((await fetchGreenhouse(entry("Stripe", "greenhouse", "stripe"), httpReturning(mutated)))[0].locations).toEqual([]);
  });
  test("a payload without `jobs` throws", async () => {
    await expect(fetchGreenhouse(entry("Stripe", "greenhouse", "stripe"), httpReturning({}))).rejects.toThrow(/jobs/);
  });
});

describe("fetchLever", () => {
  const lv = fixture("lever");
  test("maps jobs and converts createdAt ms to ISO", async () => {
    const http = httpReturning(lv);
    const jobs = await fetchLever(entry("Palantir", "lever", "palantir"), http);
    expect(http.urls[0]).toBe("https://api.lever.co/v0/postings/palantir?mode=json");
    expect(jobs).toHaveLength(5);
    expect(jobs[0]).toMatchObject({ source: "lever", company: "Palantir", sourceId: lv[0].id, url: lv[0].hostedUrl });
    expect(jobs[0].postedAt).toBe(new Date(lv[0].createdAt).toISOString());
    expect(jobs[0].locations.length).toBeGreaterThan(0);
  });
  test("workplaceType remote sets remoteHint", async () => {
    const jobs = await fetchLever(entry("P", "lever", "p"), httpReturning([{ ...lv[0], workplaceType: "remote" }]));
    expect(jobs[0].remoteHint).toBe(true);
  });
  test("a non-array payload throws", async () => {
    await expect(fetchLever(entry("P", "lever", "p"), httpReturning({ ok: false }))).rejects.toThrow();
  });
});

describe("fetchAshby", () => {
  const ab = fixture("ashby");
  test("maps jobs with primary and secondary locations", async () => {
    const withSecondary = { jobs: [{ ...ab.jobs[0], location: "Toronto", secondaryLocations: [{ location: "Remote - Canada" }] }] };
    const http = httpReturning(withSecondary);
    const jobs = await fetchAshby(entry("OpenAI", "ashby", "openai"), http);
    expect(http.urls[0]).toBe("https://api.ashbyhq.com/posting-api/job-board/openai");
    expect(jobs[0]).toMatchObject({
      source: "ashby", company: "OpenAI", sourceId: ab.jobs[0].id, url: ab.jobs[0].jobUrl,
      locations: ["Toronto", "Remote - Canada"], postedAt: new Date(ab.jobs[0].publishedAt).toISOString(),
    });
  });
  test("isRemote sets remoteHint", async () => {
    const jobs = await fetchAshby(entry("O", "ashby", "o"), httpReturning({ jobs: [{ ...ab.jobs[0], isRemote: true }] }));
    expect(jobs[0].remoteHint).toBe(true);
  });
  test("fixture parses to 5 jobs", async () => {
    expect(await fetchAshby(entry("O", "ashby", "o"), httpReturning(ab))).toHaveLength(5);
  });
  test("a payload without `jobs` throws", async () => {
    await expect(fetchAshby(entry("O", "ashby", "o"), httpReturning({ error: "x" }))).rejects.toThrow(/jobs/);
  });
});

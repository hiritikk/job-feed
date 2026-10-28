import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fetchSimplify, fetchVanshb03 } from "../pipeline/adapters/simplify.js";
import { parseHanzili, parseJobright, parseSpeedyApply } from "../pipeline/adapters/communityLists.js";
import type { Http } from "../pipeline/types.js";

const json = (name: string) => JSON.parse(readFileSync(`tests/fixtures/${name}.json`, "utf8"));
const md = (name: string) => readFileSync(`tests/fixtures/${name}.md`, "utf8");
const now = new Date("2026-10-27T12:00:00Z");
const httpJson = (body: unknown): Http & { urls: string[] } => {
  const urls: string[] = [];
  return { urls, json: async (u: string) => (urls.push(u), body as never), text: async () => "" };
};

describe("fetchSimplify / fetchVanshb03", () => {
  test("keeps only active, visible entries and maps fields", async () => {
    const data = json("simplify");
    const http = httpJson(data);
    const jobs = await fetchSimplify(http);
    expect(http.urls[0]).toBe("https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json");
    expect(jobs).toHaveLength(9); // 9 active + 1 inactive in the fixture
    expect(jobs[0]).toMatchObject({
      source: "simplify", sourceId: data[0].id, company: data[0].company_name, title: data[0].title,
      url: data[0].url, locations: data[0].locations, sponsorshipHint: data[0].sponsorship,
      postedAt: new Date(data[0].date_posted * 1000).toISOString(),
    });
  });
  test("is_visible:false entries are dropped", async () => {
    const data = json("simplify").map((e: any, i: number) => (i === 0 ? { ...e, is_visible: false } : e));
    expect(await fetchSimplify(httpJson(data))).toHaveLength(8);
  });
  test("vanshb03 uses its own url and source name", async () => {
    const http = httpJson(json("vanshb03"));
    const jobs = await fetchVanshb03(http);
    expect(http.urls[0]).toBe("https://raw.githubusercontent.com/vanshb03/New-Grad-2027/dev/.github/scripts/listings.json");
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => j.source === "vanshb03")).toBe(true);
  });
  test("a non-array payload throws", async () => {
    await expect(fetchSimplify(httpJson({ message: "Not Found" }))).rejects.toThrow(/array/);
  });
});

describe("parseSpeedyApply", () => {
  test("extracts company, title, location, apply url and approximate age", () => {
    const jobs = parseSpeedyApply(md("speedyapply"), now);
    expect(jobs.length).toBeGreaterThanOrEqual(5);
    const stripe = jobs.find((j) => j.company === "Stripe")!;
    expect(stripe).toMatchObject({ source: "speedyapply", title: "Software Engineer - New Grad", locations: ["Taiwan"], postedApprox: true });
    expect(stripe.url).toBe("https://stripe.com/jobs/search?gh_jid=8202299");
    expect(stripe.postedAt).toBe("2026-10-23T12:00:00.000Z"); // "4d"
  });
});

describe("parseHanzili", () => {
  test("strips emoji and id comment, appends Canada, leaves postedAt null", () => {
    const jobs = parseHanzili(md("hanzili"));
    const ktek = jobs.find((j) => j.company === "KTek Resourcing")!;
    expect(ktek).toMatchObject({ source: "hanzili", title: "Fresh Graduate – Java Full Stack Developer", sourceId: "875727899", postedAt: null });
    expect(ktek.url).toBe("https://www.linkedin.com/jobs/view/4477680626/");
    expect(ktek.locations[0]).toMatch(/Toronto.*Canada/);
  });
  test("'No roles currently' sections produce no rows", () => {
    expect(parseHanzili("## Security\n_No roles currently_\n")).toEqual([]);
  });
});

describe("parseJobright", () => {
  test("parses rows, carries company across ↳ rows, infers the year from 'Oct 27'", () => {
    const jobs = parseJobright(md("jobright"), now);
    expect(jobs).toHaveLength(4);
    expect(jobs[0]).toMatchObject({ source: "jobright", company: "Strategy", title: "Associate Cloud Support Engineer", postedApprox: true });
    expect(jobs[0].postedAt).toBe("2026-10-27T00:00:00.000Z");
    expect(jobs[3].company).toBe("Amazon");
    expect(jobs[3].remoteHint).toBe(true);
  });
  test("a date in the future of 'now' is assigned to the previous year", () => {
    const rows = "| Company | Job Title | Location | Work Model | Date Posted |\n| - | - | - | - | - |\n| **[X](https://x.com)** | **[SWE](https://jobright.ai/jobs/info/1)** | Toronto, Canada | Hybrid | Dec 30 |\n";
    expect(parseJobright(rows, now)[0].postedAt).toBe("2025-12-30T00:00:00.000Z");
  });
});

import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fetchSimplify, fetchVanshb03 } from "../pipeline/adapters/simplify.js";
import { communityAdapters, parseAmbicuity, parseApplyGuy, parseHanzili, parseJobright, parseSpeedyApply } from "../pipeline/adapters/communityLists.js";
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
    expect(stripe).toMatchObject({ source: "speedyapply", title: "Software Engineer - New Grad", locations: ["Taiwan"], postedPrecision: "day" });
    expect(stripe.url).toBe("https://stripe.com/jobs/search?gh_jid=8202299");
    expect(stripe.postedAt).toBe("2026-10-23T12:00:00.000Z"); // "4d"
  });
});

describe("parseSpeedyApply precision", () => {
  test("ages in days are day precision; ages in hours or months are approximate", () => {
    const row = (age: string) => `| <a href="https://x.com"><strong>X</strong></a> | SWE | Toronto, Canada | <a href="https://x.com/j/${age}"><img alt="Apply"/></a> | ${age} |`;
    const jobs = parseSpeedyApply(["| Company | Position | Location | Posting | Age |", "|---|---|---|---|---|", row("4d"), row("5h"), row("2mo")].join("\n"), now);
    expect(jobs.map((j) => j.postedPrecision)).toEqual(["day", "approx", "approx"]);
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
    expect(jobs[0]).toMatchObject({ source: "jobright", company: "Strategy", title: "Associate Cloud Support Engineer", postedPrecision: "day" });
    expect(jobs[0].postedAt).toBe("2026-10-27T00:00:00.000Z");
    expect(jobs[3].company).toBe("Amazon");
    expect(jobs[3].remoteHint).toBe(true);
  });
  test("a date in the future of 'now' is assigned to the previous year", () => {
    const rows = "| Company | Job Title | Location | Work Model | Date Posted |\n| - | - | - | - | - |\n| **[X](https://x.com)** | **[SWE](https://jobright.ai/jobs/info/1)** | Toronto, Canada | Hybrid | Dec 30 |\n";
    expect(parseJobright(rows, now)[0].postedAt).toBe("2025-12-30T00:00:00.000Z");
  });
});

describe("parseSpeedyApply salary tables", () => {
  test("rows from tables with a Salary column are kept, and the source name can be overridden", () => {
    const md = [
      "| Company | Position | Location | Salary | Posting | Age |",
      "|---|---|---|---|---|---|",
      '| <a href="https://www.nvidia.com"><strong>NVIDIA</strong></a> | Research Scientist - New College Grad 2026 | Santa Clara, CA | $172k/yr | <a href="https://nvidia.wd5.myworkdayjobs.com/job/1"><img alt="Apply"/></a> | 5d |',
    ].join("\n");
    const jobs = parseSpeedyApply(md, now, "speedyapply_ai");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ source: "speedyapply_ai", company: "NVIDIA", url: "https://nvidia.wd5.myworkdayjobs.com/job/1", locations: ["Santa Clara, CA"], postedPrecision: "day" });
    expect(jobs[0].postedAt).toBe("2026-10-22T12:00:00.000Z");
  });
});

describe("parseAmbicuity", () => {
  const job = (over: Record<string, unknown> = {}) => ({
    id: "job_1", company: "iCapital", title: "Software Integration Engineer - Associate", location: "Toronto, Ontario, Canada",
    url: "https://job-boards.greenhouse.io/icapitalnetwork/jobs/8930954002", posted_at: "2026-11-04T21:38:45.812Z",
    category: { id: "software_engineering" }, flags: { no_sponsorship: false, us_citizenship_required: false }, is_closed: false, description: "",
    ...over,
  });
  test("maps fields, splits multi-city locations and keeps the exact timestamp", () => {
    const [j] = parseAmbicuity({ jobs: [job({ location: "Stamford, CT; Irving, TX" })] });
    expect(j).toMatchObject({ source: "ambicuity", sourceId: "job_1", company: "iCapital", url: "https://job-boards.greenhouse.io/icapitalnetwork/jobs/8930954002", locations: ["Stamford, CT", "Irving, TX"], postedAt: "2026-11-04T21:38:45.812Z", postedPrecision: "exact" });
  });
  test("a midnight timestamp is a date, not an exact time", () => {
    expect(parseAmbicuity({ jobs: [job({ posted_at: "2026-09-07T00:00:00Z" })] })[0].postedPrecision).toBe("day");
  });
  test("drops closed postings and non-engineering categories", () => {
    const jobs = parseAmbicuity({ jobs: [job(), job({ id: "2", is_closed: true }), job({ id: "3", category: { id: "sales" } })] });
    expect(jobs.map((j) => j.sourceId)).toEqual(["job_1"]);
  });
  test("passes the citizenship and sponsorship flags to the work-authorization classifier", () => {
    const [cit, noSp] = parseAmbicuity({ jobs: [job({ flags: { us_citizenship_required: true } }), job({ id: "2", flags: { no_sponsorship: true } })] });
    expect(cit.sponsorshipHint).toMatch(/citizenship is required/i);
    expect(noSp.sponsorshipHint).toMatch(/does not offer/i);
  });
  test("a payload without a jobs array throws", () => {
    expect(() => parseAmbicuity({ message: "nope" })).toThrow(/jobs/);
  });
});

describe("parseApplyGuy", () => {
  test("links to the employer's own listing rather than the tracked redirect", () => {
    const [j] = parseApplyGuy({ jobs: [{
      id: "abc", company: "RTX", title: "Software Engineer I (Onsite)", location: "Cedar Rapids, IA", eligibility: "New Grad", posted: "2026-11-04",
      url: "https://applyguy.ai/jobs?company=RTX&job=abc&utm_source=github", listingUrl: "https://globalhr.wd5.myworkdayjobs.com/job/1",
    }] });
    expect(j).toMatchObject({ source: "applyguy", sourceId: "abc", url: "https://globalhr.wd5.myworkdayjobs.com/job/1", locations: ["Cedar Rapids, IA"], postedAt: "2026-11-04T00:00:00.000Z", postedPrecision: "day" });
  });
  test("falls back to the tracked url when there is no listing url", () => {
    expect(parseApplyGuy({ jobs: [{ id: "a", company: "X", title: "SWE", location: "Remote", posted: "2026-11-04", url: "https://applyguy.ai/jobs?job=a" }] })[0].url).toBe("https://applyguy.ai/jobs?job=a");
  });
  test("a payload without a jobs array throws", () => {
    expect(() => parseApplyGuy([])).toThrow(/jobs/);
  });
});

describe("communityAdapters", () => {
  test("registers every list, and fetches the renamed speedyapply repos and the new sources from the right urls", async () => {
    const urls: string[] = [];
    const http: Http = { json: async (u: string) => (urls.push(u), { jobs: [] } as never), text: async (u: string) => (urls.push(u), "") };
    const adapters = communityAdapters(http, now);
    expect(Object.keys(adapters).sort()).toEqual(["ambicuity", "applyguy", "hanzili", "jobright", "simplify", "speedyapply", "speedyapply_ai", "vanshb03"]);
    await Promise.all(["speedyapply", "speedyapply_ai", "ambicuity", "applyguy"].map((k) => adapters[k]()));
    expect(urls).toEqual(expect.arrayContaining([
      "https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/NEW_GRAD_USA.md",
      "https://raw.githubusercontent.com/speedyapply/2027-AI-College-Jobs/main/NEW_GRAD_INTL.md",
      "https://jobs.riteshrana.engineer/jobs.json",
      "https://raw.githubusercontent.com/ApplyGuy/2027-New-Grad-Jobs/main/data/new-grad-jobs.json",
    ]));
  });
});

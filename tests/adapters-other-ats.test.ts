import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fetchWorkday, parseWorkdayPosted } from "../pipeline/adapters/workday.js";
import { fetchWorkable } from "../pipeline/adapters/workable.js";
import { fetchSmartRecruiters } from "../pipeline/adapters/smartrecruiters.js";
import type { CompanyEntry, Http } from "../pipeline/types.js";

const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/${name}.json`, "utf8"));

describe("parseWorkdayPosted", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  test.each([
    ["Posted 7 Days Ago", "2026-10-20T12:00:00.000Z"],
    ["Posted Today", "2026-10-27T12:00:00.000Z"],
    ["Posted Yesterday", "2026-10-26T12:00:00.000Z"],
    ["Posted 30+ Days Ago", "2026-09-27T12:00:00.000Z"],
    ["Posted 1 Day Ago", "2026-10-26T12:00:00.000Z"],
  ])("%s", (text, iso) => expect(parseWorkdayPosted(text, now)).toBe(iso));
  test("unparseable text falls back to now", () => {
    expect(parseWorkdayPosted("???", now)).toBe(now.toISOString());
  });
});

describe("fetchWorkday", () => {
  const nvidia: CompanyEntry = { name: "NVIDIA", ats: "workday", slug: "nvidia", tier: 1, site: "NVIDIAExternalCareerSite", wd: 5 };
  const wd = fixture("workday");
  const now = new Date("2026-10-27T12:00:00Z");

  test("maps fixture jobs with absolute urls and approximate dates", async () => {
    const calls: { url: string; body: any }[] = [];
    const http: Http = {
      json: async (url: string, init?: RequestInit) => (calls.push({ url, body: JSON.parse(String(init?.body)) }), { ...wd, total: 5 } as never),
      text: async () => "",
    };
    const jobs = await fetchWorkday(nvidia, http, { queries: [""], now });
    expect(calls[0].url).toBe("https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs");
    expect(jobs).toHaveLength(5);
    expect(jobs[0]).toMatchObject({
      source: "workday", company: "NVIDIA", postedPrecision: "approx",
      url: `https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite${wd.jobPostings[0].externalPath}`,
      sourceId: wd.jobPostings[0].bulletFields[0],
    });
  });

  test("'N Days Ago' under 30 is day precision; '30+ Days Ago' stays approximate", async () => {
    const http: Http = { json: async () => ({ total: 2, jobPostings: [
      { title: "A", externalPath: "/job/a_JR1", locationsText: "Toronto", postedOn: "Posted 14 Days Ago", bulletFields: ["JR1"] },
      { title: "B", externalPath: "/job/b_JR2", locationsText: "Toronto", postedOn: "Posted 30+ Days Ago", bulletFields: ["JR2"] },
    ] }) as never, text: async () => "" };
    const jobs = await fetchWorkday(nvidia, http, { queries: [""], now });
    expect(jobs.map((j) => j.postedPrecision)).toEqual(["day", "approx"]);
  });

  test("pages until offset reaches total (40 jobs, 20 per page)", async () => {
    const offsets: number[] = [];
    const page = (offset: number) => ({
      total: 40,
      jobPostings: Array.from({ length: 20 }, (_, i) => ({
        title: `Software Engineer ${offset + i}`, externalPath: `/job/x/Software-Engineer_${offset + i}`,
        locationsText: "Toronto, ON", postedOn: "Posted Today", bulletFields: [`JR${offset + i}`],
      })),
    });
    const http: Http = {
      json: async (_u: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        offsets.push(body.offset);
        return page(body.offset) as never;
      },
      text: async () => "",
    };
    const jobs = await fetchWorkday(nvidia, http, { queries: [""], now });
    expect(offsets).toEqual([0, 20]);
    expect(jobs).toHaveLength(40);
  });

  test("'3 Locations' placeholder does not become a location", async () => {
    const http: Http = { json: async () => ({ total: 1, jobPostings: [{ ...wd.jobPostings[0], locationsText: "3 Locations" }] }) as never, text: async () => "" };
    expect((await fetchWorkday(nvidia, http, { queries: [""], now }))[0].locations).toEqual([]);
  });

  test("same job returned by two queries is deduped by externalPath", async () => {
    const http: Http = { json: async () => ({ total: 1, jobPostings: [wd.jobPostings[0]] }) as never, text: async () => "" };
    expect(await fetchWorkday(nvidia, http, { queries: ["a", "b"], now })).toHaveLength(1);
  });

  test("a payload without jobPostings throws", async () => {
    const http: Http = { json: async () => ({ errorCode: "x" }) as never, text: async () => "" };
    await expect(fetchWorkday(nvidia, http, { queries: [""], now })).rejects.toThrow(/jobPostings/);
  });
});

describe("fetchWorkable", () => {
  const wk = fixture("workable");
  const entry: CompanyEntry = { name: "Hugging Face", ats: "workable", slug: "huggingface", tier: 2 };
  test("maps widget jobs", async () => {
    const http: Http = { json: async () => wk as never, text: async () => "" };
    const jobs = await fetchWorkable(entry, http);
    expect(jobs).toHaveLength(5);
    expect(jobs[0]).toMatchObject({
      source: "workable", company: "Hugging Face", title: wk.jobs[0].title, url: wk.jobs[0].url,
      sourceId: wk.jobs[0].shortcode, remoteHint: true,
    });
    expect(jobs[0].locations).toContain("Paris, France");
    expect(jobs[0].postedAt).toBe("2026-05-29T00:00:00.000Z");
  });
  test("payload without jobs throws", async () => {
    const http: Http = { json: async () => ({}) as never, text: async () => "" };
    await expect(fetchWorkable(entry, http)).rejects.toThrow(/jobs/);
  });
});

describe("fetchSmartRecruiters", () => {
  const sr = fixture("smartrecruiters");
  const entry: CompanyEntry = { name: "ServiceNow", ats: "smartrecruiters", slug: "ServiceNow", tier: 2 };
  test("maps postings", async () => {
    const http: Http = { json: async () => ({ ...sr, totalFound: 5 }) as never, text: async () => "" };
    const jobs = await fetchSmartRecruiters(entry, http);
    expect(jobs).toHaveLength(5);
    expect(jobs[0]).toMatchObject({
      source: "smartrecruiters", company: "ServiceNow", sourceId: sr.content[0].id, title: sr.content[0].name,
      url: `https://jobs.smartrecruiters.com/ServiceNow/${sr.content[0].id}`, postedAt: sr.content[0].releasedDate,
      locations: ["Vancouver, British Columbia, Canada"], remoteHint: true,
    });
  });
  test("asks for Canadian postings explicitly, then the worldwide list, and merges them without duplicates", async () => {
    const urls: string[] = [];
    const posting = (id: string, name: string) => ({ ...sr.content[0], id, name });
    const http: Http = {
      json: async (url: string) => {
        urls.push(url);
        return (url.includes("country=ca")
          ? { totalFound: 2, content: [posting("1", "Canada role"), posting("2", "Shared role")] }
          : { totalFound: 2, content: [posting("2", "Shared role"), posting("3", "World role")] }) as never;
      },
      text: async () => "",
    };
    const jobs = await fetchSmartRecruiters(entry, http);
    expect(urls[0]).toContain("country=ca");
    expect(urls.some((u) => !u.includes("country="))).toBe(true);
    expect(jobs.map((j) => j.sourceId).sort()).toEqual(["1", "2", "3"]);
  });
  test("totalFound 0 returns []", async () => {
    const http: Http = { json: async () => ({ offset: 0, limit: 5, totalFound: 0, content: [] }) as never, text: async () => "" };
    expect(await fetchSmartRecruiters(entry, http)).toEqual([]);
  });
  test("payload without content throws", async () => {
    const http: Http = { json: async () => ({ message: "no" }) as never, text: async () => "" };
    await expect(fetchSmartRecruiters(entry, http)).rejects.toThrow(/content/);
  });
});

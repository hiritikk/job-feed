import { describe, test, expect } from "vitest";
import { validateCompany, validateAll } from "../scripts/validate-companies.js";
import type { CompanyEntry, Http, RawJob } from "../pipeline/types.js";

const entry = (over: Partial<CompanyEntry> = {}): CompanyEntry => ({ name: "Acme", ats: "greenhouse", slug: "acme", tier: 1, ...over });
const http = {} as Http;
const jobs = (n: number): RawJob[] => Array.from({ length: n }, (_, i) => ({ source: "x", sourceId: String(i), company: "Acme", title: "t", url: "https://a.test", locations: [], postedAt: null }));

describe("validateCompany", () => {
  test("an entry returning jobs is ok with its count", async () => {
    expect(await validateCompany(entry(), http, { greenhouse: async () => jobs(12) })).toEqual({ ok: true, jobCount: 12 });
  });
  test("a fetch error is reported with the message", async () => {
    const res = await validateCompany(entry(), http, { greenhouse: async () => { throw new Error("HTTP 404 https://x"); } });
    expect(res).toMatchObject({ ok: false, jobCount: 0, error: expect.stringContaining("HTTP 404") });
  });
  test("zero jobs is a failure", async () => {
    expect(await validateCompany(entry(), http, { greenhouse: async () => [] })).toMatchObject({ ok: false, error: expect.stringMatching(/zero jobs/i) });
  });
  test("custom entries are skipped as ok", async () => {
    expect(await validateCompany(entry({ ats: "custom", slug: "amazon" }), http, {})).toEqual({ ok: true, jobCount: -1 });
  });
});

describe("validateAll", () => {
  test("returns only the failures and counts them", async () => {
    const entries = [entry({ name: "A", slug: "a" }), entry({ name: "B", slug: "b" })];
    const fetchers = { greenhouse: async (e: CompanyEntry) => { if (e.slug === "b") throw new Error("HTTP 404"); return jobs(3); } };
    const res = await validateAll(entries, http, fetchers);
    expect(res.failures.map((f) => f.entry.name)).toEqual(["B"]);
    expect(res.checked).toBe(2);
  });
});

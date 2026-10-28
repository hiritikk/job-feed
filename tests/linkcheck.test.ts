import { describe, test, expect, vi } from "vitest";
import { classifyLink, createProbe, verifyLinks, type Probe } from "../pipeline/linkcheck.js";
import type { Job } from "../pipeline/types.js";

const NOW = new Date("2026-10-27T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("classifyLink", () => {
  const deep = "https://boards.greenhouse.io/stripe/jobs/123456";
  test.each([
    ["404", 404, deep, deep, "dead"],
    ["410", 410, deep, deep, "dead"],
    ["200 same url", 200, deep, deep, "ok"],
    ["200 redirected to ?error=true (Greenhouse closed job)", 200, deep, "https://boards.greenhouse.io/stripe?error=true", "dead"],
    ["200 redirected from a deep job path to the careers root", 200, "https://acme.com/careers/jobs/123/software-engineer", "https://acme.com/careers", "dead"],
    ["200 redirected to a different deep path", 200, "https://acme.com/jobs/1/swe", "https://acme.com/en/jobs/1/swe", "ok"],
    ["200 redirected to a not-found page", 200, deep, "https://acme.com/job-not-found", "dead"],
    ["403 bot wall", 403, deep, deep, "unknown"],
    ["429 rate limited", 429, deep, deep, "unknown"],
    ["999 LinkedIn wall", 999, deep, deep, "unknown"],
    ["500 server error", 500, deep, deep, "unknown"],
    ["401 login wall", 401, deep, deep, "unknown"],
  ])("%s -> %s", (_n, status, original, finalUrl, expected) => expect(classifyLink(original, status as number, finalUrl as string)).toBe(expected));
});

function job(n: number, over: Partial<Job> = {}): Job {
  return {
    id: `id${n}`, company: "Acme", title: `SWE ${n}`, url: `https://acme.com/jobs/${n}/swe`, locations: [], countries: [], cities: [], remote: "unknown",
    remoteRegions: [], postedAt: daysAgo(1), postedApprox: false, postedPrecision: "exact", firstSeenAt: daysAgo(1), lastSeenAt: daysAgo(0),
    closedAt: null, linkStatus: "unknown", linkCheckedAt: null, resolvedUrl: null, source: "jobright", sources: ["jobright"], roleType: "sde", level: "new-grad",
    gradYear: null, workAuth: "unknown", tier: 2, snippet: "", ...over,
  };
}
const probeReturning = (status: number, finalUrl?: string): Probe & { calls: string[] } => {
  const calls: string[] = [];
  const p = async (url: string) => (calls.push(url), { status, finalUrl: finalUrl ?? url });
  return Object.assign(p, { calls });
};

describe("verifyLinks", () => {
  test("checks unchecked non-direct jobs and records the result", async () => {
    const probe = probeReturning(200);
    const out = await verifyLinks([job(1)], probe, { now: NOW });
    expect(out[0]).toMatchObject({ linkStatus: "ok", linkCheckedAt: NOW.toISOString() });
  });
  test("a 404 marks the job dead", async () => {
    const out = await verifyLinks([job(1)], probeReturning(404), { now: NOW });
    expect(out[0].linkStatus).toBe("dead");
  });
  test("jobs whose winning source is a direct employer source are not probed", async () => {
    const probe = probeReturning(404);
    const out = await verifyLinks([job(1, { source: "greenhouse", sources: ["greenhouse"] })], probe, { now: NOW });
    expect(probe.calls).toHaveLength(0);
    expect(out[0].linkStatus).toBe("unknown");
  });
  test("respects the budget, unchecked first, then oldest check", async () => {
    const probe = probeReturning(200);
    const jobs = [
      job(1, { linkStatus: "ok", linkCheckedAt: daysAgo(10) }),
      job(2),
      job(3, { linkStatus: "ok", linkCheckedAt: daysAgo(20) }),
      job(4),
    ];
    await verifyLinks(jobs, probe, { now: NOW, budget: 3 });
    expect(probe.calls.sort()).toEqual(["https://acme.com/jobs/2/swe", "https://acme.com/jobs/3/swe", "https://acme.com/jobs/4/swe"]);
  });
  test("recently checked 'ok' links are not rechecked; stale 'unknown' links are retried after a day", async () => {
    const probe = probeReturning(200);
    await verifyLinks([job(1, { linkStatus: "ok", linkCheckedAt: daysAgo(1) }), job(2, { linkStatus: "unknown", linkCheckedAt: daysAgo(2) })], probe, { now: NOW });
    expect(probe.calls).toEqual(["https://acme.com/jobs/2/swe"]);
  });
  test("a probe that throws leaves the status unknown and does not abort the run", async () => {
    const probe: Probe = async (url) => { if (url.includes("/1/")) throw new Error("ECONNRESET"); return { status: 200, finalUrl: url }; };
    const out = await verifyLinks([job(1), job(2)], probe, { now: NOW });
    expect(out[0]).toMatchObject({ linkStatus: "unknown", linkCheckedAt: NOW.toISOString() });
    expect(out[1].linkStatus).toBe("ok");
  });
  test("a direct-source job that was NOT re-confirmed this run (left a windowed listing) is probed", async () => {
    const probe = probeReturning(404);
    const out = await verifyLinks([job(1, { source: "amazon", sources: ["amazon"], lastSeenAt: daysAgo(2) })], probe, { now: NOW });
    expect(probe.calls).toHaveLength(1);
    expect(out[0].linkStatus).toBe("dead");
  });
  test("a direct-source job re-confirmed this run is not probed", async () => {
    const probe = probeReturning(404);
    await verifyLinks([job(1, { source: "amazon", sources: ["amazon"], lastSeenAt: NOW.toISOString() })], probe, { now: NOW });
    expect(probe.calls).toHaveLength(0);
  });
  test("a shortlink that redirects to another site is resolved (tracking params stripped)", async () => {
    const probe = probeReturning(200, "https://boards.greenhouse.io/databricks/jobs/123?utm_source=vansh&gh_jid=123");
    const out = await verifyLinks([job(1, { url: "https://go.vansh.nyc/B2" })], probe, { now: NOW });
    expect(out[0]).toMatchObject({ linkStatus: "ok", resolvedUrl: "https://boards.greenhouse.io/databricks/jobs/123?gh_jid=123" });
  });
  test("a redirect within the same host does not set resolvedUrl", async () => {
    const out = await verifyLinks([job(1)], probeReturning(200, "https://acme.com/en/jobs/1/swe"), { now: NOW });
    expect(out[0].resolvedUrl).toBeNull();
  });
  test("a redirect to a login or auth wall is never used as the resolved link", async () => {
    const out = await verifyLinks([job(1, { url: "https://go.vansh.nyc/B3" })], probeReturning(200, "https://www.linkedin.com/authwall?trk=x"), { now: NOW });
    expect(out[0].resolvedUrl).toBeNull();
  });
  test("a dead link gets no resolvedUrl", async () => {
    const out = await verifyLinks([job(1, { url: "https://go.vansh.nyc/B2" })], probeReturning(404, "https://boards.greenhouse.io/x/jobs/1"), { now: NOW });
    expect(out[0]).toMatchObject({ linkStatus: "dead", resolvedUrl: null });
  });
  test("with a small budget, Canada-relevant early-career jobs are probed before irrelevant ones", async () => {
    const probe = probeReturning(200);
    const jobs = [
      job(1, { countries: ["US"], level: "new-grad" }),
      job(2, { countries: ["CA"], level: "other" }),
      job(3, { countries: ["CA"], level: "new-grad" }),
      job(4, { countries: [], remote: "remote", level: "early-career" }),
    ];
    await verifyLinks(jobs, probe, { now: NOW, budget: 2 });
    expect(probe.calls.sort()).toEqual(["https://acme.com/jobs/3/swe", "https://acme.com/jobs/4/swe"]);
  });
  test("closed jobs are not probed", async () => {
    const probe = probeReturning(200);
    await verifyLinks([job(1, { closedAt: daysAgo(1) })], probe, { now: NOW });
    expect(probe.calls).toHaveLength(0);
  });
  test("a dead link that was checked today is not probed again", async () => {
    const probe = probeReturning(200);
    const out = await verifyLinks([job(1, { linkStatus: "dead", linkCheckedAt: daysAgo(0) })], probe, { now: NOW });
    expect(out[0].linkStatus).toBe("dead"); // dead and checked today: not retried
    expect(probe.calls).toHaveLength(0);
  });
});

describe("createProbe", () => {
  test("uses HEAD and returns status and final url without throwing on 404", async () => {
    const fetchImpl = vi.fn(async (_u: unknown, _init?: RequestInit) => {
      const r = new Response(null, { status: 404 });
      Object.defineProperty(r, "url", { value: "https://x.test/final" });
      return r;
    });
    const probe = createProbe({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await probe("https://x.test/a")).toEqual({ status: 404, finalUrl: "https://x.test/final" });
    expect(fetchImpl.mock.calls[0][1]?.method).toBe("HEAD");
  });
  test("falls back to GET when HEAD is not allowed (405)", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const probe = createProbe({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((await probe("https://x.test/a")).status).toBe(200);
    expect(fetchImpl.mock.calls[1][1]?.method).toBe("GET");
  });
  test("sends the honest User-Agent", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    await createProbe({ fetchImpl: fetchImpl as unknown as typeof fetch, userAgent: "job-feed/1.0 test" })("https://x.test/a");
    const init = (fetchImpl.mock.calls as unknown as [string, RequestInit][])[0][1];
    expect(new Headers(init.headers).get("user-agent")).toBe("job-feed/1.0 test");
  });
});

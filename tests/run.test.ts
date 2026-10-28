import { describe, test, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "../pipeline/run.js";
import { loadAlertRules } from "../pipeline/config.js";
import type { CompanyEntry, Http, JobsFile, RawJob } from "../pipeline/types.js";
import type { Probe } from "../pipeline/linkcheck.js";

const rules = loadAlertRules();
const companies: CompanyEntry[] = [{ name: "Acme", ats: "custom", slug: "acme", tier: 1 }];
const t0 = new Date("2026-10-27T12:00:00.000Z");
const later = (mins: number) => new Date(t0.getTime() + mins * 60_000);

const raw = (n: number, over: Partial<RawJob> = {}): RawJob => ({
  source: "greenhouse", sourceId: String(n), company: "Acme", title: `Software Engineer, New Grad ${n}`,
  url: `https://boards.greenhouse.io/acme/jobs/${n}`, locations: ["Toronto, ON"], postedAt: "2026-10-27T08:00:00.000Z", ...over,
});

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "run-"));
  const ntfy: any[] = [];
  let ntfyFails = false;
  const http: Http = {
    json: async (url: string, init?: RequestInit) => {
      if (url === "https://ntfy.sh") {
        if (ntfyFails) throw new Error("HTTP 500 https://ntfy.sh");
        ntfy.push(JSON.parse(String(init?.body)));
      }
      return {} as never;
    },
    text: async () => "",
  };
  let probeStatus = 200;
  const probe: Probe = async (url) => ({ status: probeStatus, finalUrl: url });
  const run = (now: Date, adapters: Record<string, () => Promise<RawJob[]>>, env: Record<string, string | undefined> = { NTFY_TOPIC: "t" }) =>
    runPipeline({ dataDir, now, http, probe, env, companies, rules, siteUrl: "https://jobs.example.app", sources: {}, adapterOverrides: adapters });
  const read = (): JobsFile => JSON.parse(readFileSync(join(dataDir, "jobs.json"), "utf8"));
  return { dataDir, ntfy, run, read, failNtfy: (v: boolean) => (ntfyFails = v), setProbe: (s: number) => (probeStatus = s) };
}

describe("runPipeline", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  test("first run writes jobs.json and state.json and sends nothing", async () => {
    const res = await ctx.run(t0, { greenhouse: async () => [raw(1), raw(2)] });
    expect(ctx.ntfy).toHaveLength(0);
    expect(res).toMatchObject({ jobCount: 2, firstRun: true, alerted: 0 });
    const file = ctx.read();
    expect(file.jobs).toHaveLength(2);
    expect(file.sources).toEqual([expect.objectContaining({ source: "greenhouse", status: "ok", jobCount: 2 })]);
    expect(file.generatedAt).toBe(t0.toISOString());
    expect(existsSync(join(ctx.dataDir, "state.json"))).toBe(true);
  });

  test("a later run alerts exactly once for a newly appeared matching job, and never twice", async () => {
    await ctx.run(t0, { greenhouse: async () => [raw(1)] });
    await ctx.run(later(30), { greenhouse: async () => [raw(1), raw(2)] });
    expect(ctx.ntfy).toHaveLength(1);
    expect(ctx.ntfy[0].title).toContain("Acme");
    expect(ctx.ntfy[0].click).toBe("https://boards.greenhouse.io/acme/jobs/2");
    await ctx.run(later(60), { greenhouse: async () => [raw(1), raw(2)] });
    expect(ctx.ntfy).toHaveLength(1);
  });

  test("a failing adapter is reported and does not stop the others", async () => {
    const res = await ctx.run(t0, { greenhouse: async () => [raw(1)], lever: async () => { throw new Error("HTTP 500 lever"); } });
    expect(res.jobCount).toBe(1);
    const h = Object.fromEntries(ctx.read().sources.map((s) => [s.source, s]));
    expect(h.greenhouse.status).toBe("ok");
    expect(h.lever).toMatchObject({ status: "failed", error: expect.stringContaining("lever") });
  });

  test("when every adapter fails the previous jobs are published unchanged, nothing closed, nothing alerted", async () => {
    await ctx.run(t0, { greenhouse: async () => [raw(1), raw(2)] });
    const before = ctx.read().jobs;
    await ctx.run(later(30), { greenhouse: async () => { throw new Error("HTTP 503"); } });
    const after = ctx.read();
    expect(after.jobs.map((j) => j.id).sort()).toEqual(before.map((j) => j.id).sort());
    expect(after.jobs.every((j) => j.closedAt === null)).toBe(true);
    expect(after.sources[0].status).toBe("stale");
    expect(ctx.ntfy).toHaveLength(0);
  });

  test("a failed ntfy send is retried on the next run", async () => {
    await ctx.run(t0, { greenhouse: async () => [raw(1)] });
    ctx.failNtfy(true);
    await ctx.run(later(30), { greenhouse: async () => [raw(1), raw(2)] });
    expect(ctx.ntfy).toHaveLength(0);
    ctx.failNtfy(false);
    await ctx.run(later(60), { greenhouse: async () => [raw(1), raw(2)] });
    expect(ctx.ntfy).toHaveLength(1);
  });

  test("a posting that is already old when it first appears does not alert (new source can't flood)", async () => {
    await ctx.run(t0, { greenhouse: async () => [raw(1)] });
    await ctx.run(later(30), { greenhouse: async () => [raw(1), raw(2, { postedAt: "2026-09-01T00:00:00.000Z" })] });
    expect(ctx.ntfy).toHaveLength(0);
  });

  test("non-engineering roles and internships are not published", async () => {
    await ctx.run(t0, { greenhouse: async () => [raw(1), raw(2, { title: "Account Executive" }), raw(3, { title: "Software Engineer Intern" })] });
    expect(ctx.read().jobs.map((j) => j.title)).toEqual(["Software Engineer, New Grad 1"]);
  });

  test("senior-titled roles are not published", async () => {
    await ctx.run(t0, { greenhouse: async () => [raw(1), raw(2, { title: "Senior Software Engineer" }), raw(3, { title: "Staff Backend Engineer" })] });
    expect(ctx.read().jobs.map((j) => j.title)).toEqual(["Software Engineer, New Grad 1"]);
  });

  test("a dead link from a non-direct source is marked dead and never alerted", async () => {
    await ctx.run(t0, { jobright: async () => [raw(1, { source: "jobright", url: "https://jobright.ai/jobs/info/1" })] });
    ctx.setProbe(404);
    await ctx.run(later(30), { jobright: async () => [raw(1, { source: "jobright", url: "https://jobright.ai/jobs/info/1" }), raw(2, { source: "jobright", url: "https://jobright.ai/jobs/info/2" })] });
    const jobs = ctx.read().jobs;
    expect(jobs.find((j) => j.url.endsWith("/2"))!.linkStatus).toBe("dead");
    expect(ctx.ntfy).toHaveLength(0);
  });

  test("jobs are published newest first and carry city, precision and link fields", async () => {
    await ctx.run(t0, { greenhouse: async () => [raw(1, { postedAt: "2026-10-20T00:00:00.000Z" }), raw(2, { postedAt: "2026-10-26T00:00:00.000Z" })] });
    const jobs = ctx.read().jobs;
    expect(jobs.map((j) => j.title)).toEqual(["Software Engineer, New Grad 2", "Software Engineer, New Grad 1"]);
    expect(jobs[0]).toMatchObject({ cities: ["Toronto"], postedPrecision: "exact", tier: 1 });
  });

  test("company boards go through the real ATS path: a failing board keeps its previous jobs, a healthy one is fetched", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "run-ats-"));
    const boards: Record<string, unknown> = {
      acme: { jobs: [{ id: 1, title: "Software Engineer, New Grad", absolute_url: "https://boards.greenhouse.io/acme/jobs/1", location: { name: "Toronto, ON" }, first_published: "2026-10-27T08:00:00Z", content: "" }] },
      flaky: { jobs: [{ id: 2, title: "Backend Engineer, New Grad", absolute_url: "https://boards.greenhouse.io/flaky/jobs/2", location: { name: "Vancouver, BC" }, first_published: "2026-10-27T08:00:00Z", content: "" }] },
    };
    let flakyDown = false;
    const http: Http = {
      json: async (url: string) => {
        const slug = /boards\/([^/]+)\/jobs/.exec(url)?.[1] ?? "";
        if (slug === "flaky" && flakyDown) throw new Error("HTTP 503");
        return boards[slug] as never;
      },
      text: async () => "",
    };
    const entries: CompanyEntry[] = [
      { name: "Acme", ats: "greenhouse", slug: "acme", tier: 1 },
      { name: "Flaky", ats: "greenhouse", slug: "flaky", tier: 1 },
    ];
    const probe: Probe = async (url) => ({ status: 200, finalUrl: url });
    const go = (now: Date) => runPipeline({ dataDir, now, http, probe, env: {}, companies: entries, rules, siteUrl: "https://s.app", sources: {} });
    await go(t0);
    flakyDown = true;
    await go(later(30));
    const file = JSON.parse(readFileSync(join(dataDir, "jobs.json"), "utf8")) as JobsFile;
    expect(file.jobs.map((j) => j.company).sort()).toEqual(["Acme", "Flaky"]);
    expect(file.jobs.every((j) => j.closedAt === null)).toBe(true);
    expect(file.sources.find((s) => s.source === "greenhouse")!.status).toBe("ok");
  });
});

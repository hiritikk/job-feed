import { describe, test, expect } from "vitest";
import { mergeRun, type SourceRun, type State } from "../pipeline/diff.js";
import { stableId } from "../pipeline/normalize.js";
import type { Job } from "../pipeline/types.js";

const NOW = new Date("2026-10-27T12:00:00.000Z");
const iso = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();

function job(n: number, over: Partial<Job> = {}): Job {
  const url = `https://boards.example.com/${n}`;
  const source = over.source ?? "greenhouse";
  return {
    id: stableId(source, String(n), url), company: "Acme", title: `Software Engineer ${n}`, url, locations: ["Toronto, ON"],
    countries: ["CA"], cities: ["Toronto"], remote: "unknown", remoteRegions: [], postedAt: iso(2), postedApprox: false, postedPrecision: "exact",
    firstSeenAt: NOW.toISOString(), lastSeenAt: NOW.toISOString(), closedAt: null, linkStatus: "unknown", linkCheckedAt: null, source, sources: [source], roleType: "sde",
    level: "new-grad", gradYear: null, workAuth: "unknown", tier: 1, snippet: "", ...over,
  };
}
const emptyState = (): State => ({ jobs: [], health: {}, alerted: [] });
const okRun = (source: string, jobs: Job[]): SourceRun => ({ source, ok: true, jobs });
const stateOf = (jobs: Job[], source = "greenhouse"): State => ({
  jobs, alerted: [],
  health: { [source]: { source, status: "ok", lastSuccessAt: iso(1), jobCount: jobs.length } },
});

describe("mergeRun", () => {
  test("with no previous state every job is new", () => {
    const r = mergeRun(emptyState(), [okRun("greenhouse", [job(1), job(2)])], NOW);
    expect(r.newJobs).toHaveLength(2);
    expect(r.jobs).toHaveLength(2);
  });

  test("a new id appears in newJobs; an existing id keeps its original firstSeenAt", () => {
    const old = job(1, { firstSeenAt: iso(5) });
    const r = mergeRun(stateOf([old]), [okRun("greenhouse", [job(1), job(2)])], NOW);
    expect(r.newJobs.map((j) => j.title)).toEqual(["Software Engineer 2"]);
    expect(r.jobs.find((j) => j.title === "Software Engineer 1")!.firstSeenAt).toBe(iso(5));
    expect(r.jobs.find((j) => j.title === "Software Engineer 2")!.firstSeenAt).toBe(NOW.toISOString());
  });

  test("a vanished job from a healthy source gets closedAt and is not new", () => {
    const r = mergeRun(stateOf([job(1), job(2)]), [okRun("greenhouse", [job(1)])], NOW);
    const gone = r.jobs.find((j) => j.title === "Software Engineer 2")!;
    expect(gone.closedAt).toBe(NOW.toISOString());
    expect(r.newJobs).toHaveLength(0);
  });

  test("closed jobs are kept for 7 days then dropped", () => {
    const prev = stateOf([job(1, { closedAt: iso(3) }), job(2, { closedAt: iso(8) }), job(3)]);
    const r = mergeRun(prev, [okRun("greenhouse", [job(3)])], NOW);
    expect(r.jobs.map((j) => j.title).sort()).toEqual(["Software Engineer 1", "Software Engineer 3"]);
  });

  test("a closed job that reappears is reopened and is not new", () => {
    const r = mergeRun(stateOf([job(1, { closedAt: iso(2), firstSeenAt: iso(9) })]), [okRun("greenhouse", [job(1)])], NOW);
    expect(r.newJobs).toHaveLength(0);
    const back = r.jobs[0];
    expect(back.closedAt).toBeNull();
    expect(back.firstSeenAt).toBe(iso(9));
  });

  test("a failed source keeps its previous jobs untouched, closes nothing, and is marked stale", () => {
    const prev = stateOf([job(1), job(2)]);
    const r = mergeRun(prev, [{ source: "greenhouse", ok: false, jobs: [], error: "HTTP 500" }], NOW);
    expect(r.jobs).toHaveLength(2);
    expect(r.jobs.every((j) => j.closedAt === null)).toBe(true);
    expect(r.newJobs).toHaveLength(0);
    expect(r.health[0]).toMatchObject({ source: "greenhouse", status: "stale", error: "HTTP 500", jobCount: 2, lastSuccessAt: iso(1) });
  });

  test("a source that returns an empty list after having many jobs is treated as stale, not as mass closure", () => {
    const many = Array.from({ length: 20 }, (_, i) => job(i + 1));
    const r = mergeRun(stateOf(many), [okRun("greenhouse", [])], NOW);
    expect(r.jobs).toHaveLength(20);
    expect(r.jobs.every((j) => j.closedAt === null)).toBe(true);
    expect(r.health[0].status).toBe("stale");
  });

  test("a source dropping from 100 to 30 jobs (more than 60% fewer) is treated as stale", () => {
    const hundred = Array.from({ length: 100 }, (_, i) => job(i + 1));
    const r = mergeRun(stateOf(hundred), [okRun("greenhouse", hundred.slice(0, 30))], NOW);
    expect(r.jobs).toHaveLength(100);
    expect(r.health[0].status).toBe("stale");
    expect(r.health[0].error).toMatch(/100.*30/);
  });

  test("a drop of exactly 50% is legitimate and closes the missing jobs", () => {
    const hundred = Array.from({ length: 100 }, (_, i) => job(i + 1));
    const r = mergeRun(stateOf(hundred), [okRun("greenhouse", hundred.slice(0, 50))], NOW);
    expect(r.health[0].status).toBe("ok");
    expect(r.jobs.filter((j) => j.closedAt).length).toBe(50);
  });

  test("a source that never succeeded is reported as failed", () => {
    const r = mergeRun(emptyState(), [{ source: "amazon", ok: false, jobs: [], error: "boom" }], NOW);
    expect(r.health[0]).toMatchObject({ source: "amazon", status: "failed", jobCount: 0, lastSuccessAt: null });
  });

  test("a job also listed by a healthy source survives when one of its sources is stale", () => {
    const both = job(1, { sources: ["greenhouse", "simplify"] });
    const r = mergeRun(stateOf([both]), [
      { source: "greenhouse", ok: false, jobs: [], error: "x" },
      okRun("simplify", [job(1, { source: "simplify" })]),
    ], NOW);
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0].closedAt).toBeNull();
    expect(r.newJobs).toHaveLength(0);
  });

  test("when the winning source changes, the job keeps its id, firstSeenAt and is not new", () => {
    const prev = job(1, { source: "greenhouse", sources: ["greenhouse", "simplify"], firstSeenAt: iso(4) });
    const nowFromSimplify = job(1, { source: "simplify", url: "https://simplify.jobs/p/xyz" });
    const r = mergeRun(stateOf([prev]), [okRun("greenhouse", []), okRun("simplify", [nowFromSimplify])], NOW);
    expect(r.newJobs).toHaveLength(0);
    expect(r.jobs[0].id).toBe(prev.id);
    expect(r.jobs[0].firstSeenAt).toBe(iso(4));
  });

  test("link check results carry over while the url is unchanged", () => {
    const checked = job(1, { linkStatus: "dead", linkCheckedAt: iso(1) });
    const r = mergeRun(stateOf([checked]), [okRun("greenhouse", [job(1)])], NOW);
    expect(r.jobs[0]).toMatchObject({ linkStatus: "dead", linkCheckedAt: iso(1) });
  });

  test("link check results are reset when the url changed", () => {
    const checked = job(1, { source: "simplify", sources: ["simplify"], linkStatus: "dead", linkCheckedAt: iso(1) });
    const moved = job(1, { source: "simplify", sources: ["simplify"], url: "https://boards.example.com/1-new" });
    const r = mergeRun(stateOf([checked], "simplify"), [okRun("simplify", [moved])], NOW);
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0]).toMatchObject({ linkStatus: "unknown", linkCheckedAt: null });
  });
});

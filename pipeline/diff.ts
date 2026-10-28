import { dedupe, fuzzyKey } from "./dedupe.js";
import { canonicalUrl } from "./normalize.js";
import type { Job, SourceHealth } from "./types.js";

export type State = { jobs: Job[]; health: Record<string, SourceHealth>; alerted: string[] };
export type SourceRun = { source: string; ok: boolean; jobs: Job[]; error?: string };

const DAY = 86_400_000;
const CLOSED_KEEP_DAYS = 7;
const DROP_RATIO = 0.4; // fewer than 40% of the previous count (more than 60% fewer) counts as a failed fetch
const MIN_PREV_FOR_DROP_CHECK = 10;

/**
 * Merges one pipeline run into the previous state (spec §6).
 * `runs[].jobs` are classified but NOT yet deduplicated; dedupe happens here, over healthy sources only, so a failed
 * source's previous jobs can be carried over instead of being mistaken for closed ones.
 */
export function mergeRun(prev: State, runs: SourceRun[], now: Date): { jobs: Job[]; health: SourceHealth[]; newJobs: Job[] } {
  const nowIso = now.toISOString();
  const prevActive = prev.jobs.filter((j) => !j.closedAt);
  const prevClosed = prev.jobs.filter((j) => j.closedAt);

  const stale = new Set<string>();
  const health: SourceHealth[] = [];
  for (const run of runs) {
    const before = prev.health[run.source];
    const prevCount = prevActive.filter((j) => j.sources.includes(run.source)).length;
    let problem: string | null = null;
    if (!run.ok) problem = run.error ?? "fetch failed";
    else if (prevCount >= MIN_PREV_FOR_DROP_CHECK && run.jobs.length < prevCount * DROP_RATIO) {
      problem = `suspicious drop: ${prevCount} -> ${run.jobs.length} jobs`;
    }
    if (problem === null) {
      health.push({ source: run.source, status: "ok", lastSuccessAt: nowIso, jobCount: run.jobs.length });
    } else {
      stale.add(run.source);
      const everSucceeded = before?.lastSuccessAt != null;
      health.push({
        source: run.source, status: everSucceeded ? "stale" : "failed", lastSuccessAt: before?.lastSuccessAt ?? null,
        jobCount: everSucceeded ? prevCount : 0, error: problem,
      });
    }
  }

  const fresh = dedupe(runs.filter((r) => !stale.has(r.source)).flatMap((r) => r.jobs));

  // Identity continuity: match fresh jobs to previous ones by id/url first, then by company|title|city when the
  // winning source changed (so a job does not turn "new" just because a different source now carries it).
  const prevAll = [...prevActive, ...prevClosed];
  const byId = new Map(prevAll.map((p) => [p.id, p]));
  const byUrl = new Map(prevAll.map((p) => [canonicalUrl(p.url), p]));
  const matched = new Set<string>();
  const pairs: { job: Job; prev: Job | undefined }[] = fresh.map((job) => {
    const p = byId.get(job.id) ?? byUrl.get(canonicalUrl(job.url));
    if (p && !matched.has(p.id)) matched.add(p.id);
    return { job, prev: p && matched.has(p.id) ? p : undefined };
  });
  const byFuzzy = new Map<string, Job>();
  for (const p of prevAll) if (!matched.has(p.id)) byFuzzy.set(fuzzyKey(p), p);
  for (const pair of pairs) {
    if (pair.prev) continue;
    const p = byFuzzy.get(fuzzyKey(pair.job));
    if (p && p.source !== pair.job.source && !matched.has(p.id)) {
      matched.add(p.id);
      pair.prev = p;
    }
  }

  const newJobs: Job[] = [];
  const jobs: Job[] = pairs.map(({ job, prev: p }) => {
    if (!p) {
      newJobs.push(job);
      return job;
    }
    return { ...job, id: p.id, firstSeenAt: p.firstSeenAt, closedAt: null };
  });

  for (const p of prevActive) {
    if (matched.has(p.id)) continue;
    if (p.sources.some((s) => stale.has(s))) jobs.push(p); // not verifiable this run: carry over unchanged
    else jobs.push({ ...p, closedAt: nowIso });
  }
  for (const p of prevClosed) {
    if (matched.has(p.id)) continue;
    if (now.getTime() - new Date(p.closedAt!).getTime() <= CLOSED_KEEP_DAYS * DAY) jobs.push(p);
  }

  return { jobs, health, newJobs };
}

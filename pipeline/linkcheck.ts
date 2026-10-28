import { isDirectSource } from "./dedupe.js";
import { Semaphore } from "./http.js";
import { stripTracking } from "./normalize.js";
import type { Job, LinkStatus } from "./types.js";

export type Probe = (url: string) => Promise<{ status: number; finalUrl: string }>;

const DAY = 86_400_000;
const OK_RECHECK_DAYS = 3;
const UNKNOWN_RECHECK_DAYS = 1;
const NOT_FOUND_PATH = /(job-?not-?found|page-?not-?found|not-found|\/404|no-longer-available|position-closed|expired)/i;

const segments = (u: URL): number => u.pathname.split("/").filter(Boolean).length;

/** dead = the posting is gone (404/410, or redirected to an error / generic listing page); unknown = could not tell (bot walls, rate limits, 5xx). */
export function classifyLink(original: string, status: number, finalUrl: string): LinkStatus {
  if (status === 404 || status === 410) return "dead";
  if (status < 200 || status >= 300) return "unknown";
  let from: URL;
  let to: URL;
  try {
    from = new URL(original);
    to = new URL(finalUrl);
  } catch {
    return "ok";
  }
  if (/[?&]error=true\b/i.test(to.search) || NOT_FOUND_PATH.test(to.pathname)) return "dead";
  if (segments(from) >= 3 && segments(to) <= 1) return "dead";
  return "ok";
}

export function createProbe(opts: { timeoutMs?: number; userAgent?: string; perHostConcurrency?: number; fetchImpl?: typeof fetch } = {}): Probe {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const userAgent = opts.userAgent ?? "job-feed/1.0 (personal job aggregator)";
  const doFetch = opts.fetchImpl ?? fetch;
  const hosts = new Map<string, Semaphore>();

  async function once(url: string, method: "HEAD" | "GET"): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await doFetch(url, { method, redirect: "follow", headers: { "user-agent": userAgent }, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  return async (url) => {
    const host = new URL(url).host;
    const sem = hosts.get(host) ?? hosts.set(host, new Semaphore(opts.perHostConcurrency ?? 2)).get(host)!;
    await sem.acquire();
    try {
      let res = await once(url, "HEAD");
      if ([400, 403, 405, 501].includes(res.status)) res = await once(url, "GET"); // some servers refuse HEAD only
      void res.body?.cancel().catch(() => {});
      return { status: res.status, finalUrl: res.url || url };
    } finally {
      sem.release();
    }
  };
}

const AUTH_WALL = /(authwall|login|signin|sign-in|checkpoint|captcha)/i;

/** The real destination of a redirect, if it is a different, public, non-login page; otherwise null. */
function resolveTarget(original: string, finalUrl: string): string | null {
  try {
    const from = new URL(original);
    const to = new URL(finalUrl);
    if (to.protocol !== "https:" || to.host === from.host) return null;
    if (/(^|\.)linkedin\.com$/i.test(to.hostname) && AUTH_WALL.test(to.pathname)) return null;
    if (AUTH_WALL.test(to.pathname)) return null;
    return stripTracking(to.toString());
  } catch {
    return null;
  }
}

const relevance = (j: Job): number => ((j.countries.includes("CA") || j.remote === "remote") && j.level !== "other" ? 0 : 1);

function due(job: Job, now: Date): boolean {
  if (job.closedAt) return false;
  // Direct employer sources are authoritative while they still list the job; once it leaves a windowed listing, verify it.
  if (isDirectSource(job.source) && job.lastSeenAt === now.toISOString()) return false;
  if (!job.linkCheckedAt) return true;
  if (job.linkStatus === "dead") return false;
  const age = (now.getTime() - new Date(job.linkCheckedAt).getTime()) / DAY;
  return age >= (job.linkStatus === "ok" ? OK_RECHECK_DAYS : UNKNOWN_RECHECK_DAYS);
}

/** Probes up to `budget` links per run (never-checked first, then oldest check) and records the result on each job. */
export async function verifyLinks(jobs: Job[], probe: Probe, opts: { now: Date; budget?: number; concurrency?: number }): Promise<Job[]> {
  const queue = jobs
    .filter((j) => due(j, opts.now))
    // never-checked first, then Canada-relevant early-career roles, then the longest since last check
    .sort((a, b) => Number(!!a.linkCheckedAt) - Number(!!b.linkCheckedAt) || relevance(a) - relevance(b) || (a.linkCheckedAt ?? "").localeCompare(b.linkCheckedAt ?? ""))
    .slice(0, opts.budget ?? 150);
  const results = new Map<string, Pick<Job, "linkStatus" | "linkCheckedAt" | "resolvedUrl">>();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < queue.length) {
      const job = queue[next++];
      let linkStatus: LinkStatus = "unknown";
      let resolvedUrl: string | null = job.resolvedUrl;
      try {
        const { status, finalUrl } = await probe(job.url);
        linkStatus = classifyLink(job.url, status, finalUrl);
        resolvedUrl = linkStatus === "ok" ? resolveTarget(job.url, finalUrl) : null;
      } catch {
        // network error: leave unknown, retried after a day
      }
      results.set(job.id, { linkStatus, linkCheckedAt: opts.now.toISOString(), resolvedUrl });
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, queue.length) }, worker));
  return jobs.map((j) => (results.has(j.id) ? { ...j, ...results.get(j.id)! } : j));
}

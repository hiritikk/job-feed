import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchArbeitnow, fetchHimalayas, fetchJobicy, fetchRemoteOk, fetchRemotive, fetchTheMuse } from "./adapters/aggregators.js";
import { ATS_FETCHERS } from "./adapters/ats.js";
import { bigTechAdapters } from "./adapters/bigtech/index.js";
import { communityAdapters } from "./adapters/communityLists.js";
import { fetchHnHiring } from "./adapters/hn.js";
import { fetchAdzuna, fetchJooble } from "./adapters/keyed.js";
import { matchesRule, planNotifications, sendNtfy } from "./alerts.js";
import { classify, isSenior } from "./classify.js";
import { loadAlertRules, loadCompanies, loadSources, type AlertRule } from "./config.js";
import { norm } from "./dedupe.js";
import { mergeRun, type SourceRun, type State } from "./diff.js";
import { createHttp } from "./http.js";
import { createProbe, verifyLinks, type Probe } from "./linkcheck.js";
import type { CompanyEntry, Http, Job, JobsFile, RawJob, Tier } from "./types.js";

export type RunOptions = {
  dataDir: string;
  now: Date;
  http: Http;
  probe: Probe;
  env: Record<string, string | undefined>;
  companies: CompanyEntry[];
  rules: AlertRule[];
  siteUrl: string;
  sources: Record<string, boolean>;
  /** Minor (tier 3) boards are split into this many groups and one group is refreshed per run; default scales with their number. */
  shards?: number;
  /** Tests: replaces every built-in adapter. */
  adapterOverrides?: Record<string, () => Promise<RawJob[]>>;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ALERT_WINDOW_HOURS = 24; // a missed alert is retried for this long
const ALERT_MAX_POSTING_AGE_DAYS = 7; // older postings that merely appeared in our data are not "new" jobs
const FAMILY_FAILURE_LIMIT = 0.5;
const MINOR_BOARDS_PER_RUN = 600;
const RUN_SLOT_MS = 30 * 60_000;

const shardOf = (slug: string, shards: number): number => [...slug].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % shards;
// Full listings: a job missing from one of these is really gone. Everything else returns only the newest N postings.
const COMPLETE_SOURCES = new Set(["greenhouse", "lever", "ashby", "workable", "bamboohr", "recruitee", "rippling", "simplify", "vanshb03", "speedyapply", "hanzili", "jobright"]);

type Task = { source: string; run: () => Promise<{ raw: RawJob[]; carried?: Job[]; ok?: boolean; error?: string }> };

function loadPrev(dataDir: string): { state: State; firstRun: boolean } {
  const jobsPath = join(dataDir, "jobs.json");
  if (!existsSync(jobsPath)) return { state: { jobs: [], health: {}, alerted: [] }, firstRun: true };
  const file = JSON.parse(readFileSync(jobsPath, "utf8")) as JobsFile;
  const statePath = join(dataDir, "state.json");
  const alerted = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, "utf8")) as { alerted: string[] }).alerted : [];
  return { state: { jobs: file.jobs, health: Object.fromEntries(file.sources.map((s) => [s.source, s])), alerted }, firstRun: false };
}

function writeAtomic(path: string, data: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, path);
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (next < items.length) await fn(items[next++]); }));
}

function buildTasks(opts: RunOptions, prev: State, firstRun: boolean): Task[] {
  if (opts.adapterOverrides) return Object.entries(opts.adapterOverrides).map(([source, run]) => ({ source, run: async () => ({ raw: await run() }) }));
  const { http, env, sources } = opts;
  const tasks: Task[] = [];
  const shards = Math.max(1, opts.shards ?? Math.ceil(opts.companies.filter((c) => c.tier === 3).length / MINOR_BOARDS_PER_RUN));

  for (const family of Object.keys(ATS_FETCHERS) as (keyof typeof ATS_FETCHERS)[]) {
    const entries = opts.companies.filter((c) => c.ats === family);
    if (entries.length === 0) continue;
    tasks.push({
      source: family,
      run: async () => {
        const raw: RawJob[] = [];
        const carried: Job[] = [];
        const failed: string[] = [];
        const keep = (entry: CompanyEntry) => prev.jobs.filter((j) => !j.closedAt && j.source === family && norm(j.company) === norm(entry.name));
        const slot = Math.floor(opts.now.getTime() / RUN_SLOT_MS);
        const due = entries.filter((e) => firstRun || e.tier <= 2 || shardOf(e.slug, shards) === slot % shards);
        for (const entry of entries) if (!due.includes(entry)) carried.push(...keep(entry)); // not this run's turn: keep what we know
        await pool(due, 8, async (entry) => {
          try {
            raw.push(...(await ATS_FETCHERS[family](entry, http)));
          } catch (err) {
            failed.push(`${entry.name} (${(err as Error).message})`);
            // keep what we already knew about this company so one flaky board can't close its jobs
            carried.push(...keep(entry));
          }
        });
        if (failed.length > 0) console.warn(`${family}: ${failed.length}/${due.length} companies failed: ${failed.slice(0, 5).join("; ")}`);
        const tooMany = failed.length > due.length * FAMILY_FAILURE_LIMIT;
        return { raw, carried, ok: !tooMany, error: tooMany ? `${failed.length}/${due.length} companies failed` : undefined };
      },
    });
  }

  const add = (name: string, run: () => Promise<RawJob[]>) => { if (sources[name] === true) tasks.push({ source: name, run: async () => ({ raw: await run() }) }); };
  for (const [name, fn] of Object.entries(communityAdapters(http, opts.now))) add(name, fn);
  add("remotive", () => fetchRemotive(http));
  add("remoteok", () => fetchRemoteOk(http));
  add("jobicy", () => fetchJobicy(http));
  add("himalayas", () => fetchHimalayas(http));
  add("arbeitnow", () => fetchArbeitnow(http));
  add("themuse", () => fetchTheMuse(http));
  add("hn", () => fetchHnHiring(http));
  if (env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY) add("adzuna", () => fetchAdzuna(http, env));
  if (env.JOOBLE_KEY) add("jooble", () => fetchJooble(http, env));
  for (const [name, fn] of Object.entries(bigTechAdapters(http))) add(name, fn);
  return tasks;
}

export async function runPipeline(opts: RunOptions): Promise<{ jobCount: number; newCount: number; alerted: number; firstRun: boolean }> {
  const { now } = opts;
  mkdirSync(opts.dataDir, { recursive: true });
  const { state: prev, firstRun } = loadPrev(opts.dataDir);
  const tiers = new Map<string, Tier>(opts.companies.map((c) => [norm(c.name), c.tier]));
  const tierOf = (company: string): Tier => tiers.get(norm(company)) ?? 3;

  const runs: SourceRun[] = await Promise.all(
    buildTasks(opts, prev, firstRun).map(async (task): Promise<SourceRun> => {
      try {
        const out = await task.run();
        const jobs = out.raw.flatMap((r) => {
          const job = classify(r, tierOf, now);
          return job && job.roleType !== "other" && !isSenior(job.title) ? [job] : [];
        });
        const rejected = out.raw.length - jobs.length;
        console.log(`${task.source}: ${out.raw.length} fetched, ${jobs.length} kept${rejected ? ` (${rejected} dropped: internships, senior, non-engineering, bad links)` : ""}`);
        return { source: task.source, ok: out.ok ?? true, jobs: [...jobs, ...(out.carried ?? [])], error: out.error, complete: COMPLETE_SOURCES.has(task.source) };
      } catch (err) {
        console.warn(`${task.source}: FAILED ${(err as Error).message}`);
        return { source: task.source, ok: false, jobs: [], error: (err as Error).message, complete: COMPLETE_SOURCES.has(task.source) };
      }
    }),
  );

  const merged = mergeRun(prev, runs, now);
  const jobs = (await verifyLinks(merged.jobs, opts.probe, { now })).sort((a, b) => b.postedAt.localeCompare(a.postedAt));

  const alerted = new Set(prev.alerted);
  let sentCount = 0;
  if (firstRun) {
    for (const j of jobs) alerted.add(j.id); // seed silently: the first run must not push the whole backlog
  } else {
    const candidates = jobs.filter((j) =>
      !j.closedAt && !alerted.has(j.id) &&
      now.getTime() - new Date(j.firstSeenAt).getTime() <= ALERT_WINDOW_HOURS * HOUR &&
      now.getTime() - new Date(j.postedAt).getTime() <= ALERT_MAX_POSTING_AGE_DAYS * DAY);
    const plan = planNotifications(candidates, opts.rules, opts.siteUrl);
    const { sentIds } = await sendNtfy(opts.http, opts.env.NTFY_TOPIC, plan.messages);
    for (const id of sentIds) alerted.add(id);
    sentCount = sentIds.length;
    // jobs that match no rule are final for alert purposes; remember them so they are not re-evaluated every run
    const matching = new Set(candidates.filter((j) => opts.rules.some((r) => matchesRule(j, r))).map((j) => j.id));
    for (const j of candidates) if (!matching.has(j.id)) alerted.add(j.id);
  }

  const liveIds = new Set(jobs.map((j) => j.id));
  const file: JobsFile = { generatedAt: now.toISOString(), sources: merged.health, jobs };
  writeAtomic(join(opts.dataDir, "jobs.json"), file);
  writeAtomic(join(opts.dataDir, "state.json"), { alerted: [...alerted].filter((id) => liveIds.has(id)) });

  return { jobCount: jobs.length, newCount: merged.newJobs.length, alerted: sentCount, firstRun };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const http = createHttp();
  const result = await runPipeline({
    dataDir: process.env.DATA_DIR ?? "data", now: new Date(), http, probe: createProbe(), env: process.env,
    companies: loadCompanies(), rules: loadAlertRules(), siteUrl: process.env.SITE_URL ?? "https://example.invalid", sources: loadSources(),
  });
  console.log(JSON.stringify(result));
}

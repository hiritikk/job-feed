// Probes a large pool of company boards (Greenhouse/Lever/Ashby/Workday slugs published under MIT by
// Feashliaa/job-board-aggregator, https://github.com/Feashliaa/job-board-aggregator) and keeps only boards that currently
// list engineering roles open to a Canadian new grad. Writes config/companies.auto.yml (merged by loadCompanies).
//
// usage: POOL_DIR=<dir with greenhouse.json lever.json ashby.json workday.json> tsx scripts/expand-companies.ts
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchAshby } from "../pipeline/adapters/ashby.js";
import { fetchGreenhouse } from "../pipeline/adapters/greenhouse.js";
import { fetchLever } from "../pipeline/adapters/lever.js";
import { fetchWorkday } from "../pipeline/adapters/workday.js";
import { classify, isSenior } from "../pipeline/classify.js";
import { loadCompanies } from "../pipeline/config.js";
import { createHttp } from "../pipeline/http.js";
import type { CompanyEntry, RawJob } from "../pipeline/types.js";

export type BoardScore = { total: number; relevant: number; canada: number; earlyCareer: number };

/** How many of a board's jobs matter to a Canadian new grad: engineering, not senior, and (in Canada, remote-eligible, or entry-level). */
export function scoreBoard(raws: RawJob[], now: Date): BoardScore {
  const score: BoardScore = { total: raws.length, relevant: 0, canada: 0, earlyCareer: 0 };
  for (const raw of raws) {
    const job = classify(raw, () => 3, now);
    if (!job || job.roleType === "other" || isSenior(job.title)) continue;
    const inCanada = job.countries.includes("CA");
    const remoteOk = job.remote === "remote" && (job.remoteRegions.length === 0 || job.remoteRegions.includes("CA"));
    const early = job.level !== "other";
    if (inCanada || remoteOk || early) score.relevant++;
    if (inCanada) score.canada++;
    if (early) score.earlyCareer++;
  }
  return score;
}

const titleCase = (slug: string): string => slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function boardEntry(ats: "greenhouse" | "lever" | "ashby" | "workday", id: string, companyName?: string): CompanyEntry {
  if (ats === "workday") {
    const [tenant, wd, site] = id.split("|");
    return { name: companyName ?? tenant, ats, slug: tenant, tier: 3, site, wd: Number(wd.replace(/\D/g, "")) };
  }
  return { name: companyName ?? titleCase(id), ats, slug: id, tier: 3 };
}

export function parsePool(items: string[], allowPipes = false): string[] {
  const ok = allowPipes ? /^[A-Za-z0-9._-]+(\|[A-Za-z0-9._-]+)*$/ : /^[A-Za-z0-9._-]+$/;
  return [...new Set(items.filter((s) => s && ok.test(s)))];
}

const yamlLine = (e: CompanyEntry, s: BoardScore): string =>
  `- { name: ${JSON.stringify(e.name)}, ats: ${e.ats}, slug: ${e.slug}, tier: ${e.tier}${e.site ? `, site: ${JSON.stringify(e.site)}, wd: ${e.wd}` : ""} }  # relevant ${s.relevant}, canada ${s.canada}, entry-level ${s.earlyCareer}`;

async function main(): Promise<void> {
  const poolDir = process.env.POOL_DIR ?? ".";
  const resultsPath = process.env.RESULTS ?? "expand-results.jsonl";
  const concurrency = Number(process.env.CONCURRENCY ?? 24);
  const now = new Date();
  const http = createHttp({ perHostConcurrency: 16, timeoutMs: 20_000 });
  const known = new Set(loadCompanies().map((c) => `${c.ats}:${c.slug.toLowerCase()}`));
  const done = new Set<string>();
  if (existsSync(resultsPath)) for (const line of readFileSync(resultsPath, "utf8").split("\n").filter(Boolean)) done.add(JSON.parse(line).key);

  const work: { ats: "greenhouse" | "lever" | "ashby" | "workday"; id: string }[] = [];
  for (const ats of ["greenhouse", "lever", "ashby", "workday"] as const) {
    const pool = parsePool(JSON.parse(readFileSync(join(poolDir, `${ats}.json`), "utf8")) as string[], ats === "workday");
    for (const id of pool) {
      const e = boardEntry(ats, id);
      const key = `${ats}:${id.toLowerCase()}`;
      if (!known.has(`${ats}:${e.slug.toLowerCase()}`) && !done.has(key)) work.push({ ats, id });
    }
  }
  console.log(`probing ${work.length} boards (${done.size} already done)`);

  let next = 0;
  let finished = 0;
  async function worker(): Promise<void> {
    while (next < work.length) {
      const { ats, id } = work[next++];
      const entry = boardEntry(ats, id);
      let record: Record<string, unknown>;
      try {
        const raws =
          ats === "greenhouse" ? await fetchGreenhouse(entry, http, { content: false })
          : ats === "lever" ? await fetchLever(entry, http)
          : ats === "ashby" ? await fetchAshby(entry, http)
          : await fetchWorkday(entry, http, { queries: ["software engineer"], maxPages: 1, now });
        record = { key: `${ats}:${id.toLowerCase()}`, ats, id, score: scoreBoard(raws, now) };
      } catch (err) {
        record = { key: `${ats}:${id.toLowerCase()}`, ats, id, error: (err as Error).message.slice(0, 80) };
      }
      appendFileSync(resultsPath, JSON.stringify(record) + "\n");
      if (++finished % 500 === 0) console.log(`${finished}/${work.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const kept = readFileSync(resultsPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.score?.relevant > 0);
  kept.sort((a, b) => b.score.canada - a.score.canada || b.score.relevant - a.score.relevant);
  const header = "# Auto-discovered boards (scripts/expand-companies.ts). Source of the slugs: github.com/Feashliaa/job-board-aggregator (MIT).\n# Each board listed engineering roles open to a Canadian new grad when it was probed.\n";
  writeFileSync("config/companies.auto.yml", header + kept.map((r) => yamlLine(boardEntry(r.ats, r.id), r.score)).join("\n") + "\n");
  console.log(`kept ${kept.length} boards -> config/companies.auto.yml`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

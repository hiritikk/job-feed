import { canonicalUrl } from "./normalize.js";
import type { Job } from "./types.js";

// Lower number wins: direct employer sources > community lists > aggregators.
const DIRECT = new Set(["greenhouse", "lever", "ashby", "workday", "workable", "smartrecruiters", "bamboohr", "recruitee", "rippling", "amazon", "google", "microsoft", "netflix", "oracle"]);
const COMMUNITY = new Set(["simplify", "vanshb03", "speedyapply", "hanzili", "jobright"]);
export const isDirectSource = (source: string): boolean => DIRECT.has(source);
const priority = (source: string): number => (DIRECT.has(source) ? 0 : COMMUNITY.has(source) ? 1 : 2);

const PRECISION_RANK = { exact: 0, day: 1, approx: 2, none: 3 } as const;
const SUFFIX = /\b(inc|incorporated|ltd|limited|llc|corp|corporation|co|company|gmbh|plc)\b/g;
export const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
const city = (j: Job): string => (j.locations[0] ?? "").split(",")[0].toLowerCase().trim();
export const fuzzyKey = (j: Job): string => `${norm(j.company)}|${norm(j.title)}|${city(j)}`;

export function dedupe(jobs: Job[]): Job[] {
  // Union-find over two keys. Canonical URL always merges. The fuzzy key (company|title|city) only merges groups that
  // have no source in common: two requisitions from the same source with the same title are distinct openings
  // (e.g. several "SDE I, Toronto" reqs at Amazon) and must both survive.
  const parent = jobs.map((_, i) => i);
  const srcs = new Map<number, Set<string>>(jobs.map((j, i) => [i, new Set(j.sources)]));
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    parent[ra] = rb;
    for (const s of srcs.get(ra)!) srcs.get(rb)!.add(s);
  };
  const urlSeen = new Map<string, number>();
  const fuzzySeen = new Map<string, number>();
  jobs.forEach((j, i) => {
    const u = `u:${canonicalUrl(j.url)}`;
    const prevUrl = urlSeen.get(u);
    if (prevUrl === undefined) urlSeen.set(u, i);
    else union(i, prevUrl);

    const f = fuzzyKey(j);
    const prevFuzzy = fuzzySeen.get(f);
    if (prevFuzzy === undefined) fuzzySeen.set(f, i);
    else if (find(prevFuzzy) !== find(i) && ![...srcs.get(find(i))!].some((s) => srcs.get(find(prevFuzzy))!.has(s))) union(i, prevFuzzy);
  });

  const groups = new Map<number, Job[]>();
  jobs.forEach((j, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), j]);
  });

  return [...groups.values()].map((members) => {
    const sorted = [...members].sort((a, b) => priority(a.source) - priority(b.source));
    const winner = sorted[0];
    // The date comes from the best-precision source (ties go to the higher-priority source), never "whichever is earliest":
    // an aggregator's repost date must not override the employer's own timestamp.
    const best = sorted.reduce((b, j) => (PRECISION_RANK[j.postedPrecision] < PRECISION_RANK[b.postedPrecision] ? j : b), winner);
    return {
      ...winner,
      sources: [...new Set(sorted.flatMap((m) => m.sources))],
      postedAt: best.postedAt,
      postedApprox: best.postedApprox,
      postedPrecision: best.postedPrecision,
      firstSeenAt: members.reduce((min, j) => (j.firstSeenAt < min ? j.firstSeenAt : min), winner.firstSeenAt),
    };
  });
}

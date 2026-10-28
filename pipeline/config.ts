import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { CompanyEntry, Country, Job } from "./types.js";

const tier = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const companySchema = z
  .object({
    name: z.string().min(1),
    ats: z.enum(["greenhouse", "lever", "ashby", "workday", "workable", "smartrecruiters", "bamboohr", "recruitee", "rippling", "custom"]),
    slug: z.string().min(1),
    tier,
    site: z.string().optional(),
    wd: z.number().int().optional(),
  })
  .refine((c) => c.ats !== "workday" || (c.site && c.wd !== undefined), {
    message: "workday entries need both `site` and `wd`",
    path: ["site"],
  });

const alertRuleSchema = z.object({
  name: z.string(),
  countries: z.array(z.enum(["CA", "US", "GB", "EU", "OTHER"])),
  remote_ok: z.boolean(),
  levels: z.array(z.enum(["new-grad", "early-career", "other"])),
  grad_years: z.array(z.number().int().nullable()),
  role_types: z.array(z.enum(["sde", "ml-ai", "backend", "fullstack", "infra", "data", "other"])),
  tiers: z.array(tier),
  exclude_work_auth: z.array(z.enum(["none", "restricted", "sponsors", "unknown"])),
  max_years: z.number().int().min(0).optional(),
  priority: z.record(z.string(), z.enum(["high", "default", "low"])),
});

export type AlertRule = {
  name: string;
  countries: Country[];
  remote_ok: boolean;
  levels: Job["level"][];
  grad_years: (number | null)[];
  role_types: Job["roleType"][];
  tiers: (1 | 2 | 3)[];
  exclude_work_auth: Job["workAuth"][];
  /** When set, a posting that asks for more years of experience than this does not match (unknown experience still matches). */
  max_years?: number;
  priority: Record<string, "high" | "default" | "low">;
};

/** Identity of a board: ats + slug (+ site for Workday, where one tenant can host several career sites). */
export const companyKey = (e: CompanyEntry): string => `${e.ats}:${e.slug.toLowerCase()}${e.site ? `:${e.site.toLowerCase()}` : ""}`;

const readYaml = (path: string): unknown => parse(readFileSync(path, "utf8"));

function parseCompanies(path: string): CompanyEntry[] {
  const entries = z.array(companySchema).parse(readYaml(path) ?? []) as CompanyEntry[];
  const seen = new Set<string>();
  for (const e of entries) {
    const key = companyKey(e);
    if (seen.has(key)) throw new Error(`duplicate company entry: ${key}`);
    seen.add(key);
  }
  return entries;
}

/** Curated companies, followed by auto-discovered boards from the sibling companies.auto.yml (curated entries win). */
export function loadCompanies(path = "config/companies.yml"): CompanyEntry[] {
  const curated = parseCompanies(path);
  const autoPath = join(dirname(path), "companies.auto.yml");
  if (!existsSync(autoPath)) return curated;
  const have = new Set(curated.map(companyKey));
  const auto = parseCompanies(autoPath).filter((c) => !have.has(companyKey(c)));
  return [...curated, ...auto];
}

export function loadAlertRules(path = "config/alerts.yml"): AlertRule[] {
  return z.array(alertRuleSchema).parse(readYaml(path) ?? []) as AlertRule[];
}

export function loadSources(path = "config/sources.yml"): Record<string, boolean> {
  return z.record(z.string(), z.boolean()).parse(readYaml(path) ?? {});
}

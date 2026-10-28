import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import type { CompanyEntry, Country, Job } from "./types.js";

const tier = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const companySchema = z
  .object({
    name: z.string().min(1),
    ats: z.enum(["greenhouse", "lever", "ashby", "workday", "workable", "smartrecruiters"]),
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
  priority: Record<string, "high" | "default" | "low">;
};

const readYaml = (path: string): unknown => parse(readFileSync(path, "utf8"));

export function loadCompanies(path = "config/companies.yml"): CompanyEntry[] {
  const entries = z.array(companySchema).parse(readYaml(path) ?? []) as CompanyEntry[];
  const seen = new Set<string>();
  for (const e of entries) {
    const key = `${e.ats}:${e.slug.toLowerCase()}`;
    if (seen.has(key)) throw new Error(`duplicate company entry: ${key}`);
    seen.add(key);
  }
  return entries;
}

export function loadAlertRules(path = "config/alerts.yml"): AlertRule[] {
  return z.array(alertRuleSchema).parse(readYaml(path) ?? []) as AlertRule[];
}

export function loadSources(path = "config/sources.yml"): Record<string, boolean> {
  return z.record(z.string(), z.boolean()).parse(readYaml(path) ?? {});
}

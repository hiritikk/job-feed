import { describe, test, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAlertRules, loadCompanies, loadSources } from "../pipeline/config.js";

function tmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}

describe("loadAlertRules", () => {
  test("default config/alerts.yml parses to the spec §7 core rule", () => {
    const [rule] = loadAlertRules();
    expect(rule).toMatchObject({ name: "core", tiers: [1, 2], grad_years: [2027, null], countries: ["CA"], remote_ok: true });
    expect(rule.exclude_work_auth).toEqual(["restricted"]);
    expect(rule.priority[1]).toBe("high");
  });
});

describe("loadCompanies", () => {
  test("parses valid entries", () => {
    const p = tmpFile("c.yml", "- { name: Stripe, ats: greenhouse, slug: stripe, tier: 1 }\n- { name: NVIDIA, ats: workday, slug: nvidia, tier: 1, site: NVIDIAExternalCareerSite, wd: 5 }\n");
    expect(loadCompanies(p)).toHaveLength(2);
  });
  test("unknown ats throws an error naming the field", () => {
    const p = tmpFile("c.yml", "- { name: X, ats: taleo, slug: x, tier: 1 }\n");
    expect(() => loadCompanies(p)).toThrow(/ats/);
  });
  test("ats: custom is accepted for employers served by a bespoke adapter", () => {
    const p = tmpFile("c.yml", "- { name: Amazon, ats: custom, slug: amazon, tier: 1 }\n");
    expect(loadCompanies(p)[0]).toMatchObject({ name: "Amazon", ats: "custom", tier: 1 });
  });
  test("duplicate ats+slug throws", () => {
    const p = tmpFile("c.yml", "- { name: A, ats: lever, slug: a, tier: 1 }\n- { name: A2, ats: lever, slug: a, tier: 2 }\n");
    expect(() => loadCompanies(p)).toThrow(/duplicate/i);
  });
  test("workday entry without site/wd throws", () => {
    const p = tmpFile("c.yml", "- { name: N, ats: workday, slug: n, tier: 1 }\n");
    expect(() => loadCompanies(p)).toThrow(/site|wd/);
  });
});

describe("loadSources", () => {
  test("default config/sources.yml enables simplify", () => {
    expect(loadSources().simplify).toBe(true);
  });
});

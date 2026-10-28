import { describe, test, expect } from "vitest";
import { scoreBoard, boardEntry, parsePool, renderAuto, isThrottleError, type ProbeRecord } from "../scripts/expand-companies.js";
import type { RawJob } from "../pipeline/types.js";

const now = new Date("2026-10-27T12:00:00.000Z");
const raw = (title: string, locations: string[], over: Partial<RawJob> = {}): RawJob => ({
  source: "greenhouse", sourceId: title + locations.join(), company: "Acme", title, url: `https://boards.greenhouse.io/acme/jobs/${encodeURIComponent(title + locations)}`,
  locations, postedAt: "2026-10-20T00:00:00Z", ...over,
});

describe("scoreBoard", () => {
  test("counts engineering roles that are open to a Canadian new grad and ignores the rest", () => {
    const s = scoreBoard([
      raw("Software Engineer, New Grad", ["Toronto, ON"]),
      raw("Backend Engineer", ["Remote"]),
      raw("Senior Software Engineer", ["Toronto, ON"]),
      raw("Account Executive", ["Toronto, ON"]),
      raw("Software Engineer Intern", ["Toronto, ON"]),
      raw("Software Engineer", ["San Francisco, CA"]),
    ], now);
    expect(s).toMatchObject({ total: 6, relevant: 2, canada: 1, earlyCareer: 1 });
  });
  test("an entry-level role anywhere counts as relevant", () => {
    expect(scoreBoard([raw("Software Engineer I", ["London, UK"])], now).relevant).toBe(1);
  });
  test("remote-only-in-the-US is not relevant unless entry-level", () => {
    expect(scoreBoard([raw("Backend Engineer", ["Remote - US"])], now).relevant).toBe(0);
  });
  test("an empty board scores zero", () => {
    expect(scoreBoard([], now)).toEqual({ total: 0, relevant: 0, canada: 0, earlyCareer: 0 });
  });
});

describe("boardEntry", () => {
  test("builds a tier-3 entry with a readable name from the slug", () => {
    expect(boardEntry("greenhouse", "acme-corp")).toEqual({ name: "Acme Corp", ats: "greenhouse", slug: "acme-corp", tier: 3 });
  });
  test("uses the company name from the board when there is one", () => {
    expect(boardEntry("greenhouse", "x1", "Acme Inc")).toMatchObject({ name: "Acme Inc" });
  });
  test("builds a bamboohr entry", () => {
    expect(boardEntry("bamboohr", "acme-labs")).toEqual({ name: "Acme Labs", ats: "bamboohr", slug: "acme-labs", tier: 3 });
  });
  test("parses workday pool rows tenant|wdN|site", () => {
    expect(boardEntry("workday", "2020companies|wd1|external_careers")).toEqual({
      name: "2020companies", ats: "workday", slug: "2020companies", tier: 3, site: "external_careers", wd: 1,
    });
  });
});

describe("parsePool", () => {
  test("drops blanks, duplicates and slugs with unsafe characters", () => {
    expect(parsePool(["a", "a", "", "b c", "ok-1", "x/y"])).toEqual(["a", "ok-1"]);
  });
  test("keeps workday rows with pipes", () => {
    expect(parsePool(["t|wd5|Site_1"], true)).toEqual(["t|wd5|Site_1"]);
  });
});

describe("renderAuto", () => {
  const rec = (ats: ProbeRecord["ats"], id: string, relevant: number, canada: number): ProbeRecord => ({ ats, id, score: { total: 10, relevant, canada, earlyCareer: 0 } });
  test("keeps only boards with relevant jobs, Canada-heavy first, as loadable yaml", () => {
    const yaml = renderAuto([rec("greenhouse", "a", 0, 0), rec("greenhouse", "b", 3, 0), rec("lever", "c", 2, 2), { ats: "ashby", id: "dead", error: "HTTP 404" } as ProbeRecord]);
    const lines = yaml.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("slug: c");
    expect(lines[1]).toContain("slug: b");
    expect(lines[0]).toContain("# relevant 2, canada 2");
  });
  test("workday rows keep their site and datacenter", () => {
    expect(renderAuto([rec("workday", "acme|wd5|Careers", 1, 0)])).toContain('slug: acme, tier: 3, site: "Careers", wd: 5');
  });
  test("caps the list length", () => {
    const many = Array.from({ length: 50 }, (_, i) => rec("greenhouse", `b${i}`, 1, 0));
    expect(renderAuto(many, 10).split("\n").filter((l) => l.startsWith("- "))).toHaveLength(10);
  });
});

describe("isThrottleError", () => {
  test.each([
    ["HTTP 406 https://boards-api.greenhouse.io/v1/boards/x/jobs", true],
    ["HTTP 429 https://x", true],
    ["HTTP 503 https://x", true],
    ["request timed out after 20000ms: https://x", true],
    ["HTTP 404 https://boards-api.greenhouse.io/v1/boards/x/jobs", false],
    ["greenhouse x: response has no jobs array", false],
  ])("%s -> %s", (msg, expected) => expect(isThrottleError(msg)).toBe(expected));
});

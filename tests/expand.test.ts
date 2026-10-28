import { describe, test, expect } from "vitest";
import { scoreBoard, boardEntry, parsePool } from "../scripts/expand-companies.js";
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

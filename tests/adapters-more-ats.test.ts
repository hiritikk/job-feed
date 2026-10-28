import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fetchBambooHr } from "../pipeline/adapters/bamboohr.js";
import { fetchRecruitee } from "../pipeline/adapters/recruitee.js";
import { fetchRippling } from "../pipeline/adapters/rippling.js";
import type { CompanyEntry, Http } from "../pipeline/types.js";

const fx = (name: string) => JSON.parse(readFileSync(`tests/fixtures/${name}.json`, "utf8"));
const serving = (body: unknown): Http & { urls: string[] } => {
  const urls: string[] = [];
  return { urls, json: async (u: string) => (urls.push(u), body as never), text: async () => "" };
};
const entry = (name: string, ats: CompanyEntry["ats"], slug: string): CompanyEntry => ({ name, ats, slug, tier: 3 });

describe("fetchBambooHr", () => {
  const data = fx("bamboohr");
  test("maps the careers list, builds the posting url, has no date", async () => {
    const http = serving(data);
    const jobs = await fetchBambooHr(entry("1010 Games", "bamboohr", "1010games"), http);
    expect(http.urls[0]).toBe("https://1010games.bamboohr.com/careers/list");
    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toMatchObject({
      source: "bamboohr", company: "1010 Games", sourceId: data.result[0].id, title: "Senior Technical Designer",
      url: `https://1010games.bamboohr.com/careers/${data.result[0].id}`, locations: ["Warrington, Cheshire"], postedAt: null,
    });
  });
  test("isRemote sets remoteHint and country from atsLocation is appended", async () => {
    const job = { ...data.result[0], isRemote: true, atsLocation: { country: "Canada", state: null, province: "Ontario", city: "Toronto" } };
    const jobs = await fetchBambooHr(entry("X", "bamboohr", "x"), serving({ result: [job] }));
    expect(jobs[0].remoteHint).toBe(true);
    expect(jobs[0].locations.join(" ")).toContain("Canada");
  });
  test("an error payload throws", async () => {
    await expect(fetchBambooHr(entry("X", "bamboohr", "x"), serving({ error: "nope" }))).rejects.toThrow(/result/);
  });
});

describe("fetchRecruitee", () => {
  const data = fx("recruitee");
  test("maps offers with the real posting date", async () => {
    const http = serving(data);
    const jobs = await fetchRecruitee(entry("bunq", "recruitee", "bunq"), http);
    expect(http.urls[0]).toBe("https://bunq.recruitee.com/api/offers/");
    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toMatchObject({
      source: "recruitee", company: "bunq", sourceId: String(data.offers[0].id), title: data.offers[0].title,
      url: data.offers[0].careers_url, locations: [data.offers[0].location], postedAt: "2026-10-27T12:11:34.000Z",
    });
  });
  test("a not-found board throws", async () => {
    await expect(fetchRecruitee(entry("X", "recruitee", "x"), serving({ error: "Not Found" }))).rejects.toThrow(/offers/);
  });
});

describe("fetchRippling", () => {
  const data = fx("rippling");
  test("maps the board array", async () => {
    const http = serving(data);
    const jobs = await fetchRippling(entry("Rippling", "rippling", "rippling"), http);
    expect(http.urls[0]).toBe("https://api.rippling.com/platform/api/ats/v1/board/rippling/jobs");
    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toMatchObject({ source: "rippling", company: "Rippling", sourceId: data[0].uuid, title: "Account Executive, Broker Channel (Arkansas)", url: data[0].url, postedAt: null });
  });
  test("an error object throws", async () => {
    await expect(fetchRippling(entry("X", "rippling", "x"), serving({ error_code: "RESOURCE_NOT_FOUND" }))).rejects.toThrow(/array/);
  });
});

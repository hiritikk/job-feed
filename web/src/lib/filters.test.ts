import { describe, test, expect } from "vitest";
import { activeFilterCount, applyFilters, cityOptions, defaultFilters, filtersToSearch, isNewSince, searchToFilters, type Filters } from "./filters";
import { NOW, hoursAgo, makeJob } from "./testJob";

const f = (over: Partial<Filters> = {}): Filters => ({ ...defaultFilters(), ...over });
const titles = (jobs: { title: string }[]) => jobs.map((j) => j.title);

describe("defaultFilters + applyFilters", () => {
  test("default keeps a Toronto new-grad SDE and drops San Francisco, CA", () => {
    const toronto = makeJob({ title: "T" });
    const sf = makeJob({ title: "SF", countries: ["US"], cities: ["San Francisco"], locations: ["San Francisco, CA"] });
    expect(titles(applyFilters([toronto, sf], defaultFilters(), NOW))).toEqual(["T"]);
  });
  test("default hides levels other and work-auth restricted", () => {
    const jobs = [makeJob({ title: "ok" }), makeJob({ title: "senior-ish", level: "other" }), makeJob({ title: "restricted", workAuth: "restricted" })];
    expect(titles(applyFilters(jobs, defaultFilters(), NOW))).toEqual(["ok"]);
  });
  test("'no sponsorship' postings are kept (only citizenship and clearance limits are hidden)", () => {
    expect(titles(applyFilters([makeJob({ title: "ns", workAuth: "no-sponsorship" })], defaultFilters(), NOW))).toEqual(["ns"]);
  });
  test("closed and dead-link jobs are hidden unless includeClosed", () => {
    const jobs = [makeJob({ title: "open" }), makeJob({ title: "closed", closedAt: hoursAgo(2) }), makeJob({ title: "dead", linkStatus: "dead" })];
    expect(titles(applyFilters(jobs, defaultFilters(), NOW))).toEqual(["open"]);
    expect(titles(applyFilters(jobs, f({ includeClosed: true }), NOW)).sort()).toEqual(["closed", "dead", "open"]);
  });
  test("sorted by posted date, newest first", () => {
    const jobs = [makeJob({ title: "old", postedAt: hoursAgo(50) }), makeJob({ title: "new", postedAt: hoursAgo(2) })];
    expect(titles(applyFilters(jobs, defaultFilters(), NOW))).toEqual(["new", "old"]);
  });
  test("sort=found orders by firstSeenAt", () => {
    const jobs = [makeJob({ title: "a", postedAt: hoursAgo(2), firstSeenAt: hoursAgo(30) }), makeJob({ title: "b", postedAt: hoursAgo(50), firstSeenAt: hoursAgo(1) })];
    expect(titles(applyFilters(jobs, f({ sort: "found" }), NOW))).toEqual(["b", "a"]);
  });
  test("a job with no known posting date is ordered by when we found it", () => {
    const jobs = [makeJob({ title: "undated", postedPrecision: "none", postedAt: hoursAgo(0.1), firstSeenAt: hoursAgo(40) }), makeJob({ title: "dated", postedAt: hoursAgo(10) })];
    expect(titles(applyFilters(jobs, defaultFilters(), NOW))).toEqual(["dated", "undated"]);
  });
});

describe("location chips", () => {
  const remoteUnspecified = makeJob({ title: "remote-any", countries: [], cities: [], remote: "remote", remoteRegions: [], locations: ["Remote"] });
  const remoteCanada = makeJob({ title: "remote-ca", countries: ["CA"], cities: [], remote: "remote", remoteRegions: ["CA"], locations: ["Remote in Canada"] });
  const remoteUS = makeJob({ title: "remote-us", countries: ["US"], cities: [], remote: "remote", remoteRegions: ["US"], locations: ["Remote - US"] });
  const london = makeJob({ title: "london", countries: ["GB"], cities: ["London"], locations: ["London, UK"] });

  test("default CA+REMOTE keeps remote-anywhere and remote-Canada but not remote-US-only", () => {
    expect(titles(applyFilters([remoteUnspecified, remoteCanada, remoteUS], defaultFilters(), NOW)).sort()).toEqual(["remote-any", "remote-ca"]);
  });
  test("adding US also admits remote-US-only", () => {
    expect(titles(applyFilters([remoteUS, london], f({ locations: ["CA", "REMOTE", "US"] }), NOW))).toEqual(["remote-us"]);
  });
  test("GB chip admits London", () => {
    expect(titles(applyFilters([london], f({ locations: ["GB"] }), NOW))).toEqual(["london"]);
  });
  test("no location chips selected means everywhere", () => {
    expect(applyFilters([remoteUS, london, remoteCanada], f({ locations: [] }), NOW)).toHaveLength(3);
  });
});

describe("city filter", () => {
  const toronto = makeJob({ title: "toronto" });
  const vancouver = makeJob({ title: "vancouver", cities: ["Vancouver"], locations: ["Vancouver, BC"] });
  const multi = makeJob({ title: "multi", cities: ["Toronto", "Vancouver"] });
  test("selecting Vancouver keeps only jobs located in Vancouver, including multi-city postings", () => {
    expect(titles(applyFilters([toronto, vancouver, multi], f({ cities: ["Vancouver"] }), NOW)).sort()).toEqual(["multi", "vancouver"]);
  });
  test("several cities are OR-ed", () => {
    expect(applyFilters([toronto, vancouver], f({ cities: ["Toronto", "Vancouver"] }), NOW)).toHaveLength(2);
  });
  test("a city selection excludes city-less remote jobs", () => {
    const remote = makeJob({ title: "remote", countries: [], cities: [], remote: "remote", locations: ["Remote"] });
    expect(applyFilters([remote], f({ cities: ["Toronto"] }), NOW)).toHaveLength(0);
  });
  test("cityOptions lists the most common cities within the chosen countries with counts, biggest first", () => {
    const jobs = [toronto, toronto, vancouver, makeJob({ countries: ["US"], cities: ["Seattle"] })];
    expect(cityOptions(jobs.map((j) => ({ ...j })), ["CA"])).toEqual([{ city: "Toronto", count: 2 }, { city: "Vancouver", count: 1 }]);
    expect(cityOptions(jobs, []).find((o) => o.city === "Seattle")).toEqual({ city: "Seattle", count: 1 });
  });
});

describe("other filters", () => {
  test("keyword search matches title, company and city case-insensitively, all words required", () => {
    const jobs = [makeJob({ title: "Backend Engineer", company: "Shopify" }), makeJob({ title: "Frontend Engineer", company: "Shopify" })];
    expect(titles(applyFilters(jobs, f({ q: "shopify backend" }), NOW))).toEqual(["Backend Engineer"]);
    expect(applyFilters(jobs, f({ q: "TORONTO" }), NOW)).toHaveLength(2);
  });
  test("postedWithinDays drops older jobs, using the found date for undated ones", () => {
    const jobs = [makeJob({ title: "fresh", postedAt: hoursAgo(10) }), makeJob({ title: "stale", postedAt: hoursAgo(24 * 5) }),
      makeJob({ title: "undated-new", postedPrecision: "none", postedAt: hoursAgo(1), firstSeenAt: hoursAgo(1) })];
    expect(titles(applyFilters(jobs, f({ postedWithinDays: 3 }), NOW)).sort()).toEqual(["fresh", "undated-new"]);
  });
  test("tier, source, role type and grad year filters", () => {
    const jobs = [makeJob({ title: "t1", tier: 1 }), makeJob({ title: "t3", tier: 3, source: "simplify" }), makeJob({ title: "ml", roleType: "ml-ai", gradYear: 2027 })];
    expect(titles(applyFilters(jobs, f({ tiers: [1] }), NOW)).sort()).toEqual(["ml", "t1"]);
    expect(titles(applyFilters(jobs, f({ sources: ["simplify"] }), NOW))).toEqual(["t3"]);
    expect(titles(applyFilters(jobs, f({ roleTypes: ["ml-ai"] }), NOW))).toEqual(["ml"]);
    expect(titles(applyFilters(jobs, f({ gradYears: [2027] }), NOW))).toEqual(["ml"]);
    expect(titles(applyFilters(jobs, f({ gradYears: ["none"] }), NOW)).sort()).toEqual(["t1", "t3"]);
  });
  test("a job found by several sources matches a source filter on any of them", () => {
    expect(applyFilters([makeJob({ source: "greenhouse", sources: ["greenhouse", "simplify"] })], f({ sources: ["simplify"] }), NOW)).toHaveLength(1);
  });
});

describe("URL state", () => {
  test("empty search gives the defaults", () => expect(searchToFilters("")).toEqual(defaultFilters()));
  test("defaults serialize to an empty search", () => expect(filtersToSearch(defaultFilters())).toBe(""));
  test("a non-default filter set round-trips", () => {
    const custom = f({ locations: ["CA", "US"], cities: ["Toronto", "Montreal"], roleTypes: ["ml-ai", "backend"], levels: ["new-grad"], gradYears: [2027, "none"],
      tiers: [1, 2], sources: ["amazon"], postedWithinDays: 7, hideRestricted: false, includeClosed: true, hideApplied: true, sort: "found", q: "ai infra" });
    expect(searchToFilters(filtersToSearch(custom))).toEqual(custom);
  });
  test("an explicitly empty list round-trips (e.g. 'everywhere')", () => {
    expect(searchToFilters(filtersToSearch(f({ locations: [] }))).locations).toEqual([]);
  });
  test("garbage values are ignored and fall back to defaults", () => {
    const parsed = searchToFilters("?loc=ZZ,CA&tier=9,2&days=abc&role=nonsense&sort=weird&restricted=maybe");
    expect(parsed.locations).toEqual(["CA"]);
    expect(parsed.tiers).toEqual([2]);
    expect(parsed.postedWithinDays).toBeNull();
    expect(parsed.roleTypes).toEqual(defaultFilters().roleTypes);
    expect(parsed.sort).toBe("posted");
    expect(parsed.hideRestricted).toBe(true);
  });
  test("city names with commas, accents and spaces survive", () => {
    const custom = f({ cities: ["New York", "Montreal"], q: "c++ / rust" });
    expect(searchToFilters(filtersToSearch(custom))).toEqual(custom);
  });
});

describe("isNewSince", () => {
  test("true only for jobs first seen after the last visit", () => {
    expect(isNewSince(makeJob({ firstSeenAt: hoursAgo(1) }), hoursAgo(5))).toBe(true);
    expect(isNewSince(makeJob({ firstSeenAt: hoursAgo(10) }), hoursAgo(5))).toBe(false);
  });
  test("no last visit means nothing is marked new", () => {
    expect(isNewSince(makeJob(), null)).toBe(false);
  });
});

describe("activeFilterCount", () => {
  test("defaults count as zero", () => expect(activeFilterCount(defaultFilters())).toBe(0));
  test("each changed group counts once, search text counts too", () => {
    expect(activeFilterCount(f({ cities: ["Toronto", "Vancouver"] }))).toBe(1);
    expect(activeFilterCount(f({ cities: ["Toronto"], postedWithinDays: 3, q: "ml", locations: ["CA", "US"] }))).toBe(4);
  });
  test("an explicitly emptied group counts as changed", () => expect(activeFilterCount(f({ locations: [] }))).toBe(1));
});

describe("hide applied", () => {
  const a = makeJob({ id: "a" });
  const b = makeJob({ id: "b" });
  test("is off by default: applied jobs stay visible", () => {
    expect(defaultFilters().hideApplied).toBe(false);
    expect(applyFilters([a, b], defaultFilters(), NOW, { a: "2026-10-27T10:00:00.000Z" }).map((j) => j.id).sort()).toEqual(["a", "b"]);
  });
  test("when on, jobs marked applied drop out", () => {
    expect(applyFilters([a, b], f({ hideApplied: true }), NOW, { a: "2026-10-27T10:00:00.000Z" }).map((j) => j.id)).toEqual(["b"]);
  });
  test("round-trips through the URL and counts as an active filter", () => {
    expect(filtersToSearch(f({ hideApplied: true }))).toBe("?applied=hide");
    expect(searchToFilters("?applied=hide").hideApplied).toBe(true);
    expect(activeFilterCount(f({ hideApplied: true }))).toBe(1);
  });
});

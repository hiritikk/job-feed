import { describe, test, expect } from "vitest";
import { formatFound, formatPosted, formatWhen, linkLabel, shortUrlHost } from "./format";
import { NOW, hoursAgo, makeJob } from "./testJob";

describe("formatPosted", () => {
  test.each([
    [{ postedAt: hoursAgo(0.2) }, "just now"],
    [{ postedAt: hoursAgo(3) }, "3h ago"],
    [{ postedAt: hoursAgo(26) }, "1d ago"],
    [{ postedAt: hoursAgo(24 * 9) }, "9d ago"],
    [{ postedAt: hoursAgo(24 * 40) }, "Sep 17"],
  ])("exact %j -> %s", (over, expected) => expect(formatPosted(makeJob(over), NOW)).toBe(expected));

  test("day precision shows the date, not a time", () => {
    expect(formatPosted(makeJob({ postedPrecision: "day", postedAt: "2026-10-22T00:00:00.000Z" }), NOW)).toBe("Oct 22");
    expect(formatPosted(makeJob({ postedPrecision: "day", postedAt: "2026-10-27T00:00:00.000Z" }), NOW)).toBe("today");
    expect(formatPosted(makeJob({ postedPrecision: "day", postedAt: "2026-10-26T00:00:00.000Z" }), NOW)).toBe("yesterday");
  });
  test("approximate dates are prefixed with ~", () => {
    expect(formatPosted(makeJob({ postedPrecision: "approx", postedApprox: true, postedAt: hoursAgo(24 * 7) }), NOW)).toBe("~7d ago");
  });
  test("unknown dates say so instead of inventing one", () => {
    expect(formatPosted(makeJob({ postedPrecision: "none", postedApprox: true }), NOW)).toBe("date unknown");
  });
});

describe("formatFound", () => {
  test("relative time since our first sighting", () => {
    expect(formatFound(makeJob({ firstSeenAt: hoursAgo(2) }), NOW)).toBe("found 2h ago");
    expect(formatFound(makeJob({ firstSeenAt: hoursAgo(0.1) }), NOW)).toBe("found just now");
  });
});

describe("links", () => {
  test("linkLabel reflects verification state", () => {
    expect(linkLabel(makeJob({ linkStatus: "ok" }))).toBe("verified");
    expect(linkLabel(makeJob({ linkStatus: "dead" }))).toBe("link broken");
    expect(linkLabel(makeJob({ linkStatus: "unknown", source: "greenhouse" }))).toBe("from employer");
    expect(linkLabel(makeJob({ linkStatus: "unknown", source: "jobright" }))).toBe("unverified");
  });
  test("shortUrlHost shows the destination host without www", () => {
    expect(shortUrlHost("https://www.linkedin.com/jobs/view/1")).toBe("linkedin.com");
    expect(shortUrlHost("not a url")).toBe("");
  });
});

describe("formatWhen (the one line shown on a row)", () => {
  test("a dated job shows its posting date or age", () => {
    expect(formatWhen(makeJob({ postedAt: hoursAgo(3) }), NOW)).toEqual({ text: "3h ago", note: null });
    expect(formatWhen(makeJob({ postedPrecision: "day", postedAt: "2026-10-22T00:00:00.000Z" }), NOW)).toEqual({ text: "Oct 22", note: null });
  });
  test("an estimated date is marked with ~ and explained", () => {
    const w = formatWhen(makeJob({ postedPrecision: "approx", postedApprox: true, postedAt: hoursAgo(24 * 7) }), NOW);
    expect(w.text).toBe("~7d ago");
    expect(w.note).toMatch(/estimated/i);
  });
  test("an undated job shows when we found it, never a made-up posting date", () => {
    const w = formatWhen(makeJob({ postedPrecision: "none", postedApprox: true, firstSeenAt: hoursAgo(2) }), NOW);
    expect(w.text).toBe("found 2h ago");
    expect(w.note).toMatch(/no posting date/i);
  });
});

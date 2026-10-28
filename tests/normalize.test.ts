import { describe, test, expect } from "vitest";
import { canonicalUrl, stableId, toSnippet } from "../pipeline/normalize.js";

describe("canonicalUrl", () => {
  test("lowercases host, strips tracking params, hash and trailing slash", () => {
    expect(canonicalUrl("https://Boards.Greenhouse.io/x/jobs/1?utm_source=a&gh_src=b#top"))
      .toBe("https://boards.greenhouse.io/x/jobs/1");
  });
  test("keeps meaningful query params", () => {
    expect(canonicalUrl("https://stripe.com/jobs/search?gh_jid=8172487&utm_medium=x"))
      .toBe("https://stripe.com/jobs/search?gh_jid=8172487");
  });
  test("strips trailing slash", () => {
    expect(canonicalUrl("https://a.com/jobs/1/")).toBe("https://a.com/jobs/1");
  });
});

describe("stableId", () => {
  test("urls differing only in tracking params give the same id", () => {
    expect(stableId("lever", "a", "https://x.com/j/1?utm_source=a"))
      .toBe(stableId("simplify", "b", "https://x.com/j/1?ref=z"));
  });
  test("falls back to source:sourceId when url is empty", () => {
    expect(stableId("hn", "42", "")).toBe("hn:42");
  });
});

describe("toSnippet", () => {
  test("strips tags and decodes entities", () => {
    expect(toSnippet("<p>A&amp;B <b>c</b></p>")).toBe("A&B c");
  });
  test("truncates to max characters", () => {
    expect(toSnippet("x".repeat(1000)).length).toBeLessThanOrEqual(400);
  });
});

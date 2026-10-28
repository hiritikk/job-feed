import { describe, test, expect } from "vitest";
import { linkOuts } from "./linkouts";

describe("linkOuts", () => {
  const byName = (q: string) => Object.fromEntries(linkOuts(q).map((l) => [l.name, l.url]));

  test("every link is https and opens a search for Canada", () => {
    for (const l of linkOuts("")) {
      expect(l.url.startsWith("https://")).toBe(true);
      expect(l.url.toLowerCase()).toContain("canada");
    }
  });
  test("an empty query falls back to new-grad software engineer", () => {
    expect(decodeURIComponent(byName("").LinkedIn)).toContain("new grad software engineer");
  });
  test("the user's keywords are URL-encoded into each search", () => {
    const urls = byName("ml engineer c++");
    expect(urls.Indeed).toContain("ml%20engineer%20c%2B%2B");
    expect(urls.LinkedIn).toContain("ml%20engineer%20c%2B%2B");
  });
  test("LinkedIn and Indeed ask for the newest postings first", () => {
    const urls = byName("x");
    expect(urls.LinkedIn).toContain("sortBy=DD");
    expect(urls.Indeed).toContain("sort=date");
  });
  test("covers the five boards we cannot fetch", () => {
    expect(linkOuts("").map((l) => l.name)).toEqual(["LinkedIn", "Indeed", "Glassdoor", "Wellfound", "Job Bank"]);
  });
});

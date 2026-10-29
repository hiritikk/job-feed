import { describe, test, expect } from "vitest";
import { loadJobs, readApplied, readLastVisit, readRailHidden, toggleApplied, writeApplied, writeLastVisit, writeRailHidden } from "./data";
import { makeJob } from "./testJob";

const file = { generatedAt: "2026-10-27T12:00:00.000Z", sources: [], jobs: [makeJob()] };
const respond = (body: unknown, init: ResponseInit = { status: 200 }) =>
  (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), init)) as unknown as typeof fetch;

describe("loadJobs", () => {
  test("valid JSON -> ok with the parsed file", async () => {
    const res = await loadJobs("https://x.test/jobs.json", respond(file));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.jobs).toHaveLength(1);
  });
  test("a network error -> ok:false without throwing", async () => {
    const res = await loadJobs("https://x.test/jobs.json", (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch);
    expect(res).toEqual({ ok: false, error: expect.stringContaining("Failed to fetch") });
  });
  test("an HTTP error status -> ok:false mentioning the status", async () => {
    const res = await loadJobs("https://x.test/jobs.json", respond("Not Found", { status: 404 }));
    expect(res).toEqual({ ok: false, error: expect.stringContaining("404") });
  });
  test("an HTML body (e.g. a captive page) -> ok:false", async () => {
    expect((await loadJobs("https://x.test/jobs.json", respond("<html>hi</html>"))).ok).toBe(false);
  });
  test("JSON without a jobs array -> ok:false", async () => {
    expect((await loadJobs("https://x.test/jobs.json", respond({ generatedAt: "x" }))).ok).toBe(false);
  });
  test("an empty jobs array is a valid (empty) feed", async () => {
    const res = await loadJobs("https://x.test/jobs.json", respond({ ...file, jobs: [] }));
    expect(res.ok).toBe(true);
  });
});

describe("last visit storage", () => {
  test("round-trips through storage", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as unknown as Storage;
    writeLastVisit("2026-10-27T12:00:00.000Z", storage);
    expect(readLastVisit(storage)).toBe("2026-10-27T12:00:00.000Z");
  });
  test("storage that throws (private mode, blocked) yields null and never throws", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } } as unknown as Storage;
    expect(readLastVisit(broken)).toBeNull();
    expect(() => writeLastVisit("x", broken)).not.toThrow();
  });
  test("missing storage yields null", () => {
    expect(readLastVisit(undefined)).toBeNull();
  });
});

describe("filter panel preference", () => {
  const memory = () => {
    const store = new Map<string, string>();
    return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as unknown as Storage;
  };
  test("is hidden by default, remembers shown, remembers hidden again", () => {
    const s = memory();
    expect(readRailHidden(s)).toBe(true);
    writeRailHidden(false, s);
    expect(readRailHidden(s)).toBe(false);
    writeRailHidden(true, s);
    expect(readRailHidden(s)).toBe(true);
  });
  test("blocked or missing storage never throws and stays hidden", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } } as unknown as Storage;
    expect(readRailHidden(broken)).toBe(true);
    expect(readRailHidden(undefined)).toBe(true);
    expect(() => writeRailHidden(false, broken)).not.toThrow();
  });
});

describe("applied jobs", () => {
  const memory = () => {
    const store = new Map<string, string>();
    return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as unknown as Storage;
  };
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } } as unknown as Storage;
  test("starts empty and round-trips through storage", () => {
    const s = memory();
    expect(readApplied(s)).toEqual({});
    writeApplied({ a: "2026-10-27T12:00:00.000Z" }, s);
    expect(readApplied(s)).toEqual({ a: "2026-10-27T12:00:00.000Z" });
  });
  test("toggling marks a job with the time, and toggling again clears it, without touching the input", () => {
    const start = { a: "2026-10-26T00:00:00.000Z" };
    const marked = toggleApplied(start, "b", "2026-10-27T12:00:00.000Z");
    expect(marked).toEqual({ a: "2026-10-26T00:00:00.000Z", b: "2026-10-27T12:00:00.000Z" });
    expect(toggleApplied(marked, "b", "later")).toEqual(start);
    expect(start).toEqual({ a: "2026-10-26T00:00:00.000Z" });
  });
  test("corrupt or non-object stored data reads as empty; non-string entries are dropped", () => {
    const s = memory();
    s.setItem("job-feed:applied", "not json");
    expect(readApplied(s)).toEqual({});
    s.setItem("job-feed:applied", "[1,2]");
    expect(readApplied(s)).toEqual({});
    s.setItem("job-feed:applied", JSON.stringify({ a: "2026-10-27T12:00:00.000Z", b: 5 }));
    expect(readApplied(s)).toEqual({ a: "2026-10-27T12:00:00.000Z" });
  });
  test("blocked or missing storage never throws", () => {
    expect(readApplied(broken)).toEqual({});
    expect(readApplied(undefined)).toEqual({});
    expect(() => writeApplied({ a: "x" }, broken)).not.toThrow();
  });
});

import { describe, test, expect, vi } from "vitest";
import { createHttp } from "../pipeline/http.js";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("createHttp", () => {
  test("sends the User-Agent header", async () => {
    const fetchImpl = vi.fn(async (_u: unknown, _i?: RequestInit) => ok({ a: 1 }));
    const http = createHttp({ fetchImpl: fetchImpl as unknown as typeof fetch, userAgent: "job-feed/1.0 test" });
    expect(await http.json("https://x.test/a")).toEqual({ a: 1 });
    const headers = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(headers.get("user-agent")).toBe("job-feed/1.0 test");
  });

  test("retries once on a 500 then succeeds", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(ok({ done: true }));
    const http = createHttp({ fetchImpl: fetchImpl as unknown as typeof fetch, retryDelayMs: 0 });
    expect(await http.json("https://x.test/a")).toEqual({ done: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("a persistent 404 throws 'HTTP 404' without retrying", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }));
    const http = createHttp({ fetchImpl: fetchImpl as unknown as typeof fetch, retryDelayMs: 0 });
    await expect(http.json("https://x.test/a")).rejects.toThrow(/HTTP 404 https:\/\/x\.test\/a/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("a persistent 500 throws after the single retry", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 }));
    const http = createHttp({ fetchImpl: fetchImpl as unknown as typeof fetch, retryDelayMs: 0 });
    await expect(http.json("https://x.test/a")).rejects.toThrow(/HTTP 500/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("a hung request rejects at the timeout", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted")))));
      const http = createHttp({ fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 1000 });
      const p = http.json("https://x.test/slow");
      const assertion = expect(p).rejects.toThrow(/timed out|aborted/i);
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  test("never more than perHostConcurrency requests in flight per host", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return ok({});
    });
    const http = createHttp({ fetchImpl: fetchImpl as unknown as typeof fetch, perHostConcurrency: 2 });
    await Promise.all(Array.from({ length: 5 }, () => http.json("https://x.test/a")));
    expect(peak).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  test("text() returns the body", async () => {
    const http = createHttp({ fetchImpl: (async () => new Response("hello")) as unknown as typeof fetch });
    expect(await http.text("https://x.test/t")).toBe("hello");
  });
});

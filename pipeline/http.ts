import type { Http } from "./types.js";

export type HttpOptions = {
  timeoutMs?: number;
  perHostConcurrency?: number;
  userAgent?: string;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
};

export class Semaphore {
  private waiting: (() => void)[] = [];
  private active = 0;
  constructor(private readonly max: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }
  release(): void {
    const next = this.waiting.shift();
    if (next) next(); // hand the slot straight to the next waiter
    else this.active--;
  }
}

class TimeoutError extends Error {}

/** Retry-After in seconds (capped at 10 s so a run never stalls); falls back to a few seconds when absent. */
function retryAfterMs(res: Response, fallbackBase: number): number {
  const secs = Number(res.headers.get("retry-after"));
  if (res.headers.get("retry-after") !== null && Number.isFinite(secs)) return Math.min(secs * 1000, 10_000);
  return Math.min(fallbackBase * 6, 10_000);
}

export function createHttp(opts: HttpOptions = {}): Http {
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const max = opts.perHostConcurrency ?? 4;
  const userAgent = opts.userAgent ?? "job-feed/1.0 (personal job aggregator)";
  const retryDelayMs = opts.retryDelayMs ?? 500;
  const doFetch = opts.fetchImpl ?? fetch;
  const hosts = new Map<string, Semaphore>();

  const semaphoreFor = (url: string): Semaphore => {
    const host = new URL(url).host;
    let s = hosts.get(host);
    if (!s) hosts.set(host, (s = new Semaphore(max)));
    return s;
  };

  async function attempt(url: string, init: RequestInit | undefined): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const headers = new Headers(init?.headers);
      if (!headers.has("user-agent")) headers.set("user-agent", userAgent);
      return await doFetch(url, { ...init, headers, signal: controller.signal });
    } catch (err) {
      if (timedOut) throw new TimeoutError(`request timed out after ${timeoutMs}ms: ${url}`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function request(url: string, init?: RequestInit): Promise<Response> {
    const sem = semaphoreFor(url);
    await sem.acquire();
    try {
      let res: Response | undefined;
      for (let i = 0; i < 2; i++) {
        try {
          res = await attempt(url, init);
        } catch (err) {
          if (err instanceof TimeoutError || i === 1) throw err; // timeouts are not retried
          await new Promise((r) => setTimeout(r, retryDelayMs));
          continue;
        }
        const got = res;
        if ((got.status >= 500 || got.status === 429) && i === 0) {
          await new Promise((r) => setTimeout(r, got.status === 429 ? retryAfterMs(got, retryDelayMs) : retryDelayMs));
          continue;
        }
        break;
      }
      if (!res || !res.ok) throw new Error(`HTTP ${res?.status ?? "???"} ${url}`);
      return res;
    } finally {
      sem.release();
    }
  }

  return {
    async json<T = unknown>(url: string, init?: RequestInit): Promise<T> {
      return (await (await request(url, init)).json()) as T;
    },
    async text(url: string, init?: RequestInit): Promise<string> {
      return (await request(url, init)).text();
    },
  };
}

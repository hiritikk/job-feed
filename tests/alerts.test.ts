import { describe, test, expect, vi } from "vitest";
import { matchesRule, planNotifications, sendNtfy } from "../pipeline/alerts.js";
import { loadAlertRules } from "../pipeline/config.js";
import { parseLocations } from "../pipeline/location.js";
import type { Http, Job } from "../pipeline/types.js";

const [rule] = loadAlertRules();
const NOW = "2026-10-27T12:00:00.000Z";
function job(over: Partial<Job> & { loc?: string[] } = {}): Job {
  const locations = over.loc ?? ["Toronto, ON"];
  const parsed = parseLocations(locations);
  const { loc: _loc, ...rest } = over;
  return {
    id: Math.random().toString(36).slice(2), company: "Stripe", title: "Software Engineer, New Grad 2027", url: "https://stripe.com/jobs/1",
    locations, countries: parsed.countries, cities: [], postedPrecision: "exact", remote: parsed.remote, remoteRegions: parsed.remoteRegions, postedAt: NOW, postedApprox: false,
    firstSeenAt: NOW, lastSeenAt: NOW, closedAt: null, linkStatus: "unknown", linkCheckedAt: null, resolvedUrl: null, source: "greenhouse", sources: ["greenhouse"], roleType: "sde", level: "new-grad",
    gradYear: 2027, workAuth: "unknown", tier: 1, snippet: "", ...rest,
  };
}

describe("matchesRule (default core rule)", () => {
  test("a tier-1 Toronto new-grad SDE 2027 job matches", () => expect(matchesRule(job(), rule)).toBe(true));
  test("San Francisco, CA does not match (CA is California)", () => expect(matchesRule(job({ loc: ["San Francisco, CA"] }), rule)).toBe(false));
  test("remote with unspecified region matches", () => expect(matchesRule(job({ loc: ["Remote"] }), rule)).toBe(true));
  test("remote limited to Canada matches", () => expect(matchesRule(job({ loc: ["Remote in Canada"] }), rule)).toBe(true));
  test("remote limited to the US does not match", () => expect(matchesRule(job({ loc: ["Remote - US"] }), rule)).toBe(false));
  test("remote limited to an unrecognised region (APAC) does not match", () => expect(matchesRule(job({ loc: ["Remote - APAC"] }), rule)).toBe(false));
  test("gradYear 2026 does not match", () => expect(matchesRule(job({ gradYear: 2026 }), rule)).toBe(false));
  test("gradYear null matches", () => expect(matchesRule(job({ gradYear: null }), rule)).toBe(true));
  test("work-auth restricted does not match", () => expect(matchesRule(job({ workAuth: "restricted" }), rule)).toBe(false));
  test("tier 3 does not match", () => expect(matchesRule(job({ tier: 3 }), rule)).toBe(false));
  test("level other does not match", () => expect(matchesRule(job({ level: "other" }), rule)).toBe(false));
  test("role type other does not match", () => expect(matchesRule(job({ roleType: "other" }), rule)).toBe(false));
  test("a job whose link is dead does not match", () => expect(matchesRule(job({ linkStatus: "dead" }), rule)).toBe(false));
  test("a job whose link status is unknown still matches", () => expect(matchesRule(job({ linkStatus: "unknown" }), rule)).toBe(true));
  test("a closed job does not match", () => expect(matchesRule(job({ closedAt: NOW }), rule)).toBe(false));
});

describe("planNotifications", () => {
  test("one match -> one message with the posting url, tier-1 high priority", () => {
    const j = job({ title: "SDE 1", company: "Amazon", url: "https://amazon.jobs/1" });
    const plan = planNotifications([j, job({ tier: 3 })], [rule], "https://jobs.example.app");
    expect(plan.messages).toHaveLength(1);
    expect(plan.messages[0]).toMatchObject({ click: "https://amazon.jobs/1", priority: 4, ids: [j.id] });
    expect(plan.messages[0].title).toContain("Amazon");
    expect(plan.alertedIds).toEqual([j.id]);
  });
  test("tier-2 match gets default priority 3", () => {
    expect(planNotifications([job({ tier: 2 })], [rule], "https://s.app").messages[0].priority).toBe(3);
  });
  test("exactly 5 matches are sent individually", () => {
    const jobs = Array.from({ length: 5 }, () => job());
    expect(planNotifications(jobs, [rule], "https://s.app").messages).toHaveLength(5);
  });
  test("more than 5 matches collapse into one digest with the site link, all ids marked", () => {
    const jobs = Array.from({ length: 7 }, (_, i) => job({ company: `Co${i}`, tier: i < 2 ? 1 : 2 }));
    const plan = planNotifications(jobs, [rule], "https://jobs.example.app");
    expect(plan.messages).toHaveLength(1);
    expect(plan.messages[0].title).toContain("7");
    expect(plan.messages[0].click).toBe("https://jobs.example.app");
    expect(plan.messages[0].message.split("\n")).toHaveLength(3);
    expect(plan.messages[0].message).toContain("Co0");
    expect(plan.messages[0].ids).toHaveLength(7);
    expect(plan.alertedIds).toHaveLength(7);
  });
  test("no matches -> no messages", () => {
    expect(planNotifications([job({ tier: 3 })], [rule], "https://s.app")).toEqual({ messages: [], alertedIds: [] });
  });
});

describe("sendNtfy", () => {
  const msg = (over = {}) => ({ title: "Stripe: SDE", message: "Toronto", click: "https://stripe.com/1", priority: 4 as const, ids: ["a"], ...over });
  const capture = () => {
    const calls: { url: string; body: any }[] = [];
    const http: Http = { json: async (url: string, init?: RequestInit) => (calls.push({ url, body: JSON.parse(String(init?.body)) }), {} as never), text: async () => "" };
    return { http, calls };
  };

  test("posts JSON to ntfy so non-ASCII titles survive", async () => {
    const { http, calls } = capture();
    const title = "Ingénieur logiciel – Nouveau diplômé";
    const res = await sendNtfy(http, "secret-topic", [msg({ title })]);
    expect(calls[0].url).toBe("https://ntfy.sh");
    expect(calls[0].body).toMatchObject({ topic: "secret-topic", title, click: "https://stripe.com/1", priority: 4 });
    expect(res.sentIds).toEqual(["a"]);
  });
  test("a missing topic skips sending with a warning instead of crashing", async () => {
    const { http, calls } = capture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await sendNtfy(http, undefined, [msg()]);
    expect(calls).toHaveLength(0);
    expect(res.sentIds).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  test("an HTTP failure leaves the ids un-sent so they are retried next run", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const http: Http = { json: async () => { throw new Error("HTTP 500 https://ntfy.sh"); }, text: async () => "" };
    expect((await sendNtfy(http, "t", [msg()])).sentIds).toEqual([]);
    warn.mockRestore();
  });
  test("one failing message does not stop the others", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let n = 0;
    const http: Http = { json: async () => { if (n++ === 0) throw new Error("boom"); return {} as never; }, text: async () => "" };
    const res = await sendNtfy(http, "t", [msg({ ids: ["a"] }), msg({ ids: ["b"] })]);
    expect(res.sentIds).toEqual(["b"]);
    warn.mockRestore();
  });
});

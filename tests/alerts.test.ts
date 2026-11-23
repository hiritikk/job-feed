import { describe, test, expect, vi } from "vitest";
import { matchesRule, planNotifications, sendNtfy } from "../pipeline/alerts.js";
import { loadAlertRules } from "../pipeline/config.js";
import { parseLocations } from "../pipeline/location.js";
import type { Http, Job } from "../pipeline/types.js";

const [rule, plainRule, fitRule] = loadAlertRules();
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
  test("'no sponsorship' postings still match: the user can work in Canada without sponsorship", () => expect(matchesRule(job({ workAuth: "no-sponsorship" }), rule)).toBe(true));
  test("work-auth restricted does not match", () => expect(matchesRule(job({ workAuth: "restricted" }), rule)).toBe(false));
  test("tier 3 does not match", () => expect(matchesRule(job({ tier: 3 }), rule)).toBe(false));
  test("level other does not match", () => expect(matchesRule(job({ level: "other" }), rule)).toBe(false));
  test("role type other does not match", () => expect(matchesRule(job({ roleType: "other" }), rule)).toBe(false));
  test("a job whose link is dead does not match", () => expect(matchesRule(job({ linkStatus: "dead" }), rule)).toBe(false));
  test("a job whose link status is unknown still matches", () => expect(matchesRule(job({ linkStatus: "unknown" }), rule)).toBe(true));
  test("a closed job does not match", () => expect(matchesRule(job({ closedAt: NOW }), rule)).toBe(false));
  test("a posting that needs you to start before you are available (May 2027) does not match", () => expect(matchesRule(job({ startBy: "2026-12" }), rule)).toBe(false));
  test("a posting with a start date from May 2027 on matches", () => expect(matchesRule(job({ startBy: "2027-06" }), rule)).toBe(true));
  test("a posting with no stated start date matches", () => expect(matchesRule(job({ startBy: null }), rule)).toBe(true));
  test("an 'Engineer II' title does not match, even when labelled early-career", () => expect(matchesRule(job({ title: "Software Engineer II", level: "early-career", gradYear: null }), rule)).toBe(false));
  test("1 year of experience still matches (an internship may count)", () => expect(matchesRule(job({ yearsRequired: 1 }), rule)).toBe(true));
});

describe("plain-title rule (level other at tier 1-2 in Canada)", () => {
  const plain = (over: Partial<Job> & { loc?: string[] } = {}) => job({ level: "other", gradYear: null, title: "Software Engineer", ...over });
  test("a plain 'Software Engineer' at a tier-1 company in Toronto matches", () => expect(matchesRule(plain(), plainRule)).toBe(true));
  test("so does a tier-2 company", () => expect(matchesRule(plain({ tier: 2 }), plainRule)).toBe(true));
  test("an 'Engineer II' title stays out", () => expect(matchesRule(plain({ title: "Software Engineer II" }), plainRule)).toBe(false));
  test("a posting that needs you to start before May 2027 stays out", () => expect(matchesRule(plain({ startBy: "2027-01" }), plainRule)).toBe(false));
  test("it does not match when the posting asks for 5+ years", () => expect(matchesRule(plain({ yearsRequired: 5 }), plainRule)).toBe(false));
  test("it matches when the posting asks for up to 1 year or states nothing, and not for 2 or more", () => {
    expect(matchesRule(plain({ yearsRequired: 2 }), plainRule)).toBe(false);
    expect(matchesRule(plain({ yearsRequired: 1 }), plainRule)).toBe(true);
    expect(matchesRule(plain({ yearsRequired: 0 }), plainRule)).toBe(true);
    expect(matchesRule(plain({ yearsRequired: null }), plainRule)).toBe(true);
    expect(matchesRule(plain({ yearsRequired: undefined }), plainRule)).toBe(true);
  });
  test("tier 3, other countries and restricted postings stay out", () => {
    expect(matchesRule(plain({ tier: 3 }), plainRule)).toBe(false);
    expect(matchesRule(plain({ loc: ["San Francisco, CA"] }), plainRule)).toBe(false);
    expect(matchesRule(plain({ workAuth: "restricted" }), plainRule)).toBe(false);
  });
  test("the core rule still ignores plain titles, so new-grad alerts keep their own rule", () => {
    expect(matchesRule(plain(), rule)).toBe(false);
  });
  test("a plain-title job produces a normal-priority alert, a new-grad tier-1 job stays high", () => {
    const p = plain({ company: "Shopify" });
    const g = job({ company: "Stripe" });
    const plan = planNotifications([p, g], [rule, plainRule], "https://s.app");
    expect(plan.messages.find((m) => m.title.startsWith("Shopify"))!.priority).toBe(3);
    expect(plan.messages.find((m) => m.title.startsWith("Stripe"))!.priority).toBe(4);
  });
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

describe("fit ratings in alerts", () => {
  // a large employer's posting the keyword rules turn away: the text mentions 3 years somewhere
  const small = (fit?: Job["fit"]) => job({ tier: 2, level: "other", gradYear: null, yearsRequired: 3, title: "Software Developer", ...(fit ? { fit } : {}) });
  test("the keyword rules turn that posting away", () => {
    expect(matchesRule(small(), rule)).toBe(false);
    expect(matchesRule(small(), plainRule)).toBe(false);
  });
  test("the high-fit rule is for large employers only, and the core rule now skips postings asking for 2 or more years", () => {
    expect(matchesRule({ ...small({ score: 0.9, skip: null, reasons: [], newGrad: true }), tier: 3 }, fitRule)).toBe(false);
    expect(matchesRule(job({ yearsRequired: 2 }), rule)).toBe(false);
    expect(matchesRule(job({ yearsRequired: 1 }), rule)).toBe(true);
  });
  test("the high-fit rule matches such a posting only once it is rated at or above the threshold", () => {
    expect(matchesRule(small(), fitRule)).toBe(false);
    expect(matchesRule(small({ score: fitRule.min_fit! - 0.01, skip: null, reasons: [], newGrad: true }), fitRule)).toBe(false);
    expect(matchesRule(small({ score: fitRule.min_fit!, skip: null, reasons: [], newGrad: true }), fitRule)).toBe(true);
    expect(matchesRule(small({ score: 0.95, skip: null, reasons: [], newGrad: false }), fitRule)).toBe(false); // a strong skills match that is not new-grad level
    expect(matchesRule(small({ score: 0.95, skip: null, reasons: [] }), fitRule)).toBe(false);
  });
  test("an 'Engineer II' title never matches the high-fit rule, even when JEV calls it new-grad", () => {
    expect(matchesRule({ ...small({ score: 0.9, skip: null, reasons: [], newGrad: true }), title: "Software Engineer II - AI Engineering" }, fitRule)).toBe(false);
  });
  test("a posting JEV ruled out never matches the high-fit rule, whatever its score", () => {
    expect(matchesRule(small({ score: 0.9, skip: "asks for professional experience", reasons: [], newGrad: true }), fitRule)).toBe(false);
  });
  test("the keyword rules ignore the rating: a low or ruled-out rating never removes an alert", () => {
    expect(matchesRule(job({ fit: { score: 0.1, skip: "not a software role", reasons: [] } }), rule)).toBe(true);
  });
  test("the alert text carries the fit, or what to check when JEV ruled the posting out", () => {
    const text = (fit: Job["fit"]) => planNotifications([job({ fit })], [rule], "https://x.example").messages[0].message;
    expect(text({ score: 0.82, skip: null, reasons: [] })).toMatch(/ · fit 82%$/);
    expect(text({ score: 0.2, skip: "US role, no sponsorship", reasons: [] })).toMatch(/ · check: US role, no sponsorship$/);
    expect(planNotifications([job()], [rule], "https://x.example").messages[0].message).not.toContain("fit");
  });
});

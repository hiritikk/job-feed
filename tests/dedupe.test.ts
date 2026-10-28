import { describe, test, expect } from "vitest";
import { dedupe } from "../pipeline/dedupe.js";
import { stableId } from "../pipeline/normalize.js";
import type { Job } from "../pipeline/types.js";

const NOW = "2026-10-27T12:00:00.000Z";
function job(over: Partial<Job> & Pick<Job, "source" | "url">): Job {
  return {
    id: stableId(over.source, "x", over.url), company: "Stripe", title: "Software Engineer, New Grad", locations: ["Toronto, ON"],
    countries: ["CA"], cities: ["Toronto"], remote: "unknown", remoteRegions: [], postedAt: "2026-10-20T00:00:00.000Z", postedApprox: false, postedPrecision: "exact", linkStatus: "unknown", linkCheckedAt: null,
    firstSeenAt: NOW, lastSeenAt: NOW, closedAt: null, sources: [over.source], roleType: "sde", level: "new-grad",
    gradYear: null, workAuth: "unknown", tier: 1, snippet: "", ...over,
  };
}

describe("dedupe", () => {
  test("same canonical URL from simplify and greenhouse -> one job, greenhouse wins, both sources kept", () => {
    const out = dedupe([
      job({ source: "simplify", url: "https://stripe.com/jobs/1?utm_source=simplify" }),
      job({ source: "greenhouse", url: "https://stripe.com/jobs/1" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("greenhouse");
    expect([...out[0].sources].sort()).toEqual(["greenhouse", "simplify"]);
    expect(out[0].id).toBe(stableId("greenhouse", "x", "https://stripe.com/jobs/1"));
  });

  test("'Stripe, Inc.' and 'Stripe' with the same title and city merge", () => {
    const out = dedupe([
      job({ source: "remotive", url: "https://remotive.com/a", company: "Stripe, Inc." }),
      job({ source: "lever", url: "https://jobs.lever.co/stripe/1", company: "Stripe" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("lever");
  });

  test("same company and title in two different cities stay separate", () => {
    const out = dedupe([
      job({ source: "greenhouse", url: "https://stripe.com/jobs/1", locations: ["Toronto, ON"] }),
      job({ source: "greenhouse", url: "https://stripe.com/jobs/2", locations: ["Seattle, WA"] }),
    ]);
    expect(out).toHaveLength(2);
  });

  test("the winner's exact date is kept even when an aggregator copy claims an earlier one", () => {
    const out = dedupe([
      job({ source: "greenhouse", url: "https://stripe.com/jobs/1", postedAt: "2026-10-22T00:00:00.000Z", postedPrecision: "exact" }),
      job({ source: "jooble", url: "https://jooble.org/x", postedAt: "2026-10-18T00:00:00.000Z", postedPrecision: "exact" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].postedAt).toBe("2026-10-22T00:00:00.000Z");
  });

  test("when the winner's date is approximate, the best-precision date from another source is used", () => {
    const out = dedupe([
      job({ source: "workday", url: "https://nv.wd5.myworkdayjobs.com/x/job/1", postedAt: "2026-09-27T00:00:00.000Z", postedPrecision: "approx", postedApprox: true }),
      job({ source: "simplify", url: "https://simplify.jobs/p/1", postedAt: "2026-10-01T09:30:00.000Z", postedPrecision: "exact" }),
    ]);
    expect(out[0].source).toBe("workday");
    expect(out[0].postedAt).toBe("2026-10-01T09:30:00.000Z");
    expect(out[0].postedPrecision).toBe("exact");
    expect(out[0].postedApprox).toBe(false);
  });

  test("direct big-tech career sites outrank community lists and aggregators", () => {
    const out = dedupe([
      job({ source: "jobright", url: "https://jobright.ai/jobs/info/1", company: "Amazon", title: "SDE I" }),
      job({ source: "amazon", url: "https://www.amazon.jobs/en/jobs/1/sde", company: "Amazon", title: "SDE I" }),
      job({ source: "speedyapply", url: "https://www.amazon.jobs/en/jobs/1/sde?ref=x", company: "Amazon", title: "SDE I" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("amazon");
    expect(out[0].sources).toHaveLength(3);
  });

  test("postings with no location only merge with other location-less postings", () => {
    const out = dedupe([
      job({ source: "lever", url: "https://a.test/1", locations: [] }),
      job({ source: "lever", url: "https://a.test/2", locations: ["Toronto, ON"] }),
    ]);
    expect(out).toHaveLength(2);
  });

  test("distinct requisitions from the SAME source with identical title and city are never merged", () => {
    const out = dedupe([
      job({ source: "amazon", url: "https://www.amazon.jobs/en/jobs/1/sde", company: "Amazon", title: "Software Development Engineer I" }),
      job({ source: "amazon", url: "https://www.amazon.jobs/en/jobs/2/sde", company: "Amazon", title: "Software Development Engineer I" }),
      job({ source: "amazon", url: "https://www.amazon.jobs/en/jobs/3/sde", company: "Amazon", title: "Software Development Engineer I" }),
    ]);
    expect(out).toHaveLength(3);
  });

  test("an empty list stays empty", () => {
    expect(dedupe([])).toEqual([]);
  });
});

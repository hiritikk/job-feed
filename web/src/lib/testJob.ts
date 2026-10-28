import type { Job } from "./types";

export const NOW = new Date("2026-10-27T12:00:00.000Z");
export const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();

export function makeJob(over: Partial<Job> = {}): Job {
  return {
    id: Math.random().toString(36).slice(2), company: "Stripe", title: "Software Engineer, New Grad", url: "https://stripe.com/jobs/1",
    locations: ["Toronto, ON"], countries: ["CA"], cities: ["Toronto"], remote: "unknown", remoteRegions: [], postedAt: hoursAgo(5),
    postedApprox: false, postedPrecision: "exact", firstSeenAt: hoursAgo(1), lastSeenAt: hoursAgo(0), closedAt: null, linkStatus: "unknown",
    linkCheckedAt: null, resolvedUrl: null, source: "greenhouse", sources: ["greenhouse"], roleType: "sde", level: "new-grad", gradYear: null,
    workAuth: "unknown", tier: 1, snippet: "", ...over,
  };
}

import type { Job } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DIRECT = new Set(["greenhouse", "lever", "ashby", "workday", "workable", "smartrecruiters", "bamboohr", "recruitee", "rippling", "amazon", "google", "microsoft", "netflix", "oracle"]);

const monthDay = (d: Date): string => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
const utcDay = (d: Date): number => Math.floor(d.getTime() / DAY);

function relative(from: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - from.getTime());
  if (ms < HOUR) return "just now";
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`;
  return `${Math.floor(ms / DAY)}d ago`;
}

/** How to show when a job was posted without implying more precision than we have. */
export function formatPosted(job: Job, now: Date): string {
  if (job.postedPrecision === "none") return "date unknown";
  const at = new Date(job.postedAt);
  if (job.postedPrecision === "approx") {
    const days = Math.floor((now.getTime() - at.getTime()) / DAY);
    return days < 1 ? "~today" : `~${days}d ago`;
  }
  if (job.postedPrecision === "day") {
    const diff = utcDay(now) - utcDay(at);
    return diff <= 0 ? "today" : diff === 1 ? "yesterday" : monthDay(at); // a date-only source: show the date, never an hour-level age
  }
  return now.getTime() - at.getTime() > 14 * DAY ? monthDay(at) : relative(at, now);
}

/** Our own first sighting: the one timestamp that is always exact. */
export const formatFound = (job: Job, now: Date): string => `found ${relative(new Date(job.firstSeenAt), now)}`;

/** The single date line shown on a row: the posting date when there is one, otherwise honestly when we found it. */
export function formatWhen(job: Job, now: Date): { text: string; note: string | null } {
  if (job.postedPrecision === "none") return { text: formatFound(job, now), note: "No posting date is published; this is when the feed first found it." };
  return { text: formatPosted(job, now), note: job.postedPrecision === "approx" ? "Estimated from a relative age such as “7 days ago”." : null };
}

export function linkLabel(job: Job): string {
  if (job.linkStatus === "ok") return "verified";
  if (job.linkStatus === "dead") return "link broken";
  return DIRECT.has(job.source) ? "from employer" : "unverified";
}

export function shortUrlHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

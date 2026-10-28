import type { AlertRule } from "./config.js";
import type { Http, Job } from "./types.js";

export type NtfyMessage = { title: string; message: string; click: string; priority: 1 | 2 | 3 | 4 | 5; ids: string[] };

const DIGEST_THRESHOLD = 5;
const PRIORITY = { high: 4, default: 3, low: 2 } as const;

function countryMatches(job: Job, rule: AlertRule): boolean {
  if (job.countries.some((c) => rule.countries.includes(c))) return true;
  if (!rule.remote_ok || job.remote !== "remote") return false;
  // Empty remoteRegions means "remote, region not stated"; a stated region must overlap the rule's countries.
  return job.remoteRegions.length === 0 || job.remoteRegions.some((r) => (rule.countries as string[]).includes(r));
}

export function matchesRule(job: Job, rule: AlertRule): boolean {
  return (
    job.closedAt === null &&
    job.linkStatus !== "dead" &&
    countryMatches(job, rule) &&
    rule.levels.includes(job.level) &&
    rule.grad_years.includes(job.gradYear) &&
    rule.role_types.includes(job.roleType) &&
    rule.tiers.includes(job.tier) &&
    !rule.exclude_work_auth.includes(job.workAuth) &&
    (rule.max_years === undefined || job.yearsRequired === undefined || job.yearsRequired === null || job.yearsRequired <= rule.max_years)
  );
}

function priorityFor(job: Job, rule: AlertRule): NtfyMessage["priority"] {
  return PRIORITY[rule.priority[String(job.tier)] ?? "default"];
}

export function planNotifications(newJobs: Job[], rules: AlertRule[], siteUrl: string): { messages: NtfyMessage[]; alertedIds: string[] } {
  const matched = newJobs
    .map((job) => ({ job, rule: rules.find((r) => matchesRule(job, r)) }))
    .filter((m): m is { job: Job; rule: AlertRule } => m.rule !== undefined);
  if (matched.length === 0) return { messages: [], alertedIds: [] };
  const alertedIds = matched.map((m) => m.job.id);

  if (matched.length > DIGEST_THRESHOLD) {
    const top = [...matched].sort((a, b) => a.job.tier - b.job.tier || b.job.postedAt.localeCompare(a.job.postedAt)).slice(0, 3);
    const priority = Math.max(...matched.map((m) => priorityFor(m.job, m.rule))) as NtfyMessage["priority"];
    return {
      alertedIds,
      messages: [{
        title: `${matched.length} new job matches`,
        message: top.map(({ job }) => `${job.company}: ${job.title} (${job.locations[0] ?? "?"})`).join("\n"),
        click: siteUrl, priority, ids: alertedIds,
      }],
    };
  }

  return {
    alertedIds,
    messages: matched.map(({ job, rule }) => ({
      title: `${job.company}: ${job.title}`,
      message: `${job.locations.slice(0, 2).join("; ") || "location n/a"} · tier ${job.tier} · ${job.level}${job.gradYear ? ` ${job.gradYear}` : ""}`,
      click: job.url, priority: priorityFor(job, rule), ids: [job.id],
    })),
  };
}

/** Sends via ntfy's JSON API (so non-ASCII titles are safe). Returns the ids that were actually delivered. */
export async function sendNtfy(http: Http, topic: string | undefined, messages: NtfyMessage[]): Promise<{ sentIds: string[] }> {
  if (!topic) {
    if (messages.length > 0) console.warn(`NTFY_TOPIC is not set: skipping ${messages.length} notification(s)`);
    return { sentIds: [] };
  }
  const sentIds: string[] = [];
  for (const m of messages) {
    try {
      await http.json("https://ntfy.sh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic, title: m.title, message: m.message, click: m.click, priority: m.priority }),
      });
      sentIds.push(...m.ids);
    } catch (err) {
      console.warn(`ntfy delivery failed (will retry next run): ${(err as Error).message}`);
    }
  }
  return { sentIds };
}

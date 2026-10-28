import { formatWhen } from "../lib/format";
import type { Job } from "../lib/types";

const LEVEL_TEXT = { "new-grad": "New grad", "early-career": "Early career" } as const;
const REGION_TEXT: Record<string, string> = { CA: "Canada", US: "the US", GB: "the UK", EU: "Europe", OTHER: "other regions" };

export const applyUrl = (job: Job): string => job.resolvedUrl ?? job.url;

/** One quiet row. Only exceptions get a signpost: new, estimated or missing dates, work-authorization limits, broken links. */
export function JobRow({ job, now, isNew, onOpen }: { job: Job; now: Date; isNew: boolean; onOpen: (job: Job) => void }) {
  const when = formatWhen(job, now);
  const where = job.cities.length > 0 ? job.cities.slice(0, 3).join(", ") + (job.cities.length > 3 ? ` +${job.cities.length - 3}` : "") : job.locations[0] ?? "Location not stated";
  const level = job.level === "other" ? null : LEVEL_TEXT[job.level] + (job.gradYear ? ` ${job.gradYear}` : "");
  const remote = job.remote === "remote" ? `Remote${job.remoteRegions.length ? ` in ${job.remoteRegions.map((r) => REGION_TEXT[r] ?? r).join(", ")}` : ""}` : job.remote === "hybrid" ? "Hybrid" : null;
  const dead = job.linkStatus === "dead";
  return (
    <li className={`row tier${job.tier}${dead || job.closedAt ? " gone" : ""}${isNew ? " fresh" : ""}`}>
      <div className={job.postedPrecision === "none" || job.postedPrecision === "approx" ? "when soft" : "when"} title={when.note ?? undefined}>
        {when.text}
      </div>
      <div className="what">
        <button type="button" className="title" onClick={() => onOpen(job)}>
          <span className="role">{job.title}</span>
          <span className="company">{job.company}</span>
        </button>
        <div className="facts">
          {isNew && <span className="flag new">New</span>}
          <span>{where}</span>
          {remote && <span>{remote}</span>}
          {level && <span className="level">{level}</span>}
          {job.workAuth === "restricted" && <span className="flag warn" title="The posting mentions citizenship, clearance or no visa sponsorship">Work authorization limits</span>}
          {dead && <span className="flag bad">link broken</span>}
          {job.closedAt && <span className="flag warn">Closed</span>}
        </div>
      </div>
      <a className="apply" href={applyUrl(job)} target="_blank" rel="noopener noreferrer">
        Apply
      </a>
    </li>
  );
}

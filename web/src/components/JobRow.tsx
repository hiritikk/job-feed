import { formatFound, formatPosted } from "../lib/format";
import type { Job } from "../lib/types";
import { PrecisionMark, TrustMark } from "./Marks";

const LEVEL_TEXT = { "new-grad": "New grad", "early-career": "Early career", other: "Level not stated" } as const;
const ROLE_TEXT = { sde: "Software", "ml-ai": "ML and AI", backend: "Backend", fullstack: "Full stack", infra: "Infrastructure", data: "Data", other: "Other" } as const;

const REGION_TEXT: Record<string, string> = { CA: "Canada", US: "the US", GB: "the UK", EU: "Europe", OTHER: "other regions" };

export const applyUrl = (job: Job): string => job.resolvedUrl ?? job.url;

export function JobRow({ job, now, isNew, onOpen }: { job: Job; now: Date; isNew: boolean; onOpen: (job: Job) => void }) {
  const where = job.cities.length > 0 ? job.cities.slice(0, 3).join(", ") + (job.cities.length > 3 ? ` +${job.cities.length - 3}` : "") : job.locations[0] ?? "Location not stated";
  const level = LEVEL_TEXT[job.level] + (job.gradYear ? ` ${job.gradYear}` : "");
  return (
    <li className={`row tier${job.tier}${job.linkStatus === "dead" || job.closedAt ? " gone" : ""}`}>
      <div className="when">
        <span className="when-main">{formatPosted(job, now)}</span>
        <span className="when-meta">
          <PrecisionMark precision={job.postedPrecision} />
          <span className="found">{formatFound(job, now)}</span>
        </span>
      </div>
      <div className="what">
        <button type="button" className="title" onClick={() => onOpen(job)}>
          <span className="company">{job.company}</span>
          <span className="role">{job.title}</span>
        </button>
        <div className="facts">
          {isNew && <span className="badge new">New since your last visit</span>}
          <span>{where}</span>
          {job.remote === "remote" && <span className="badge">Remote{job.remoteRegions.length ? ` in ${job.remoteRegions.map((r) => REGION_TEXT[r] ?? r).join(", ")}` : ""}</span>}
          {job.remote === "hybrid" && <span className="badge">Hybrid</span>}
          <span className="badge strong">{level}</span>
          <span className="badge">{ROLE_TEXT[job.roleType]}</span>
          {job.workAuth === "restricted" && <span className="badge warn" title="The posting mentions citizenship, clearance or no visa sponsorship">Work authorization limits</span>}
          {job.closedAt && <span className="badge warn">Closed</span>}
        </div>
      </div>
      <div className="act">
        <a className="apply" href={applyUrl(job)} target="_blank" rel="noopener noreferrer">
          Apply
        </a>
        <TrustMark job={job} />
      </div>
    </li>
  );
}

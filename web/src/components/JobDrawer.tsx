import { useEffect, useRef } from "react";
import { formatApplied, formatFound, formatPosted, shortUrlHost } from "../lib/format";
import type { Job } from "../lib/types";
import { PrecisionMark, TrustMark, precisionText } from "./Marks";
import { applyUrl } from "./JobRow";

const exactTime = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const dateOnly = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });

export function JobDrawer({ job, now, applied, onClose, onToggleApplied }: { job: Job; now: Date; applied: string | null; onClose: () => void; onToggleApplied: (job: Job) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const posted =
    job.postedPrecision === "exact" ? exactTime(job.postedAt) : job.postedPrecision === "day" ? dateOnly(job.postedAt) : job.postedPrecision === "approx" ? formatPosted(job, now) : "Not published";
  const url = applyUrl(job);

  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`${job.title} at ${job.company}`} onClick={(e) => e.stopPropagation()}>
        <button ref={closeRef} type="button" className="close" onClick={onClose}>
          Close
        </button>
        <h2>
          <span className="company">{job.company}</span>
          {job.title}
        </h2>
        <a className="apply big" href={url} target="_blank" rel="noopener noreferrer">
          Apply on {shortUrlHost(url) || "the employer's site"}
        </a>
        <button type="button" className="mark-applied big" onClick={() => onToggleApplied(job)} aria-pressed={applied !== null}>
          {applied ? "Applied" : "Mark applied"}
        </button>
        {applied && <small className="applied-on">You marked this applied on {formatApplied(applied)}. Click again to undo.</small>}

        <dl className="facts-list">
          <dt>Posted</dt>
          <dd>
            {posted} <PrecisionMark precision={job.postedPrecision} />
            <small>{precisionText(job.postedPrecision)}</small>
          </dd>
          <dt>Found by this feed</dt>
          <dd>
            {exactTime(job.firstSeenAt)}
            <small>{formatFound(job, now)}. This time is always exact.</small>
          </dd>
          <dt>Link</dt>
          <dd>
            <TrustMark job={job} />
            {job.linkCheckedAt && <small>Last checked {exactTime(job.linkCheckedAt)}</small>}
            {job.resolvedUrl && <small>Opens {shortUrlHost(job.resolvedUrl)} (the list's link redirected here).</small>}
          </dd>
          <dt>Where</dt>
          <dd>{job.locations.length ? job.locations.join("; ") : "Not stated"}</dd>
          <dt>Role</dt>
          <dd>
            {job.roleType}, {job.level}
            {job.gradYear ? `, class of ${job.gradYear}` : ""}, tier {job.tier}
          </dd>
          <dt>Seen on</dt>
          <dd>{job.sources.join(", ")}</dd>
        </dl>
        {job.snippet && <p className="snippet">{job.snippet}</p>}
      </aside>
    </div>
  );
}

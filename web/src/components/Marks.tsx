import { linkLabel } from "../lib/format";
import type { Job, PostedPrecision } from "../lib/types";

const FILLED: Record<PostedPrecision, number> = { exact: 3, day: 2, approx: 1, none: 0 };
const PRECISION_TEXT: Record<PostedPrecision, string> = {
  exact: "Exact posting time from the source",
  day: "Posting date only; the time is not published",
  approx: "Estimated from a relative age such as “7 days ago”",
  none: "The source gives no posting date; we show when we first found it",
};

/** Three bars: how precisely we know when this job was posted. */
export function PrecisionMark({ precision }: { precision: PostedPrecision }) {
  return (
    <span className="precision" role="img" aria-label={PRECISION_TEXT[precision]} title={PRECISION_TEXT[precision]}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={i < FILLED[precision] ? "bar on" : "bar"} />
      ))}
    </span>
  );
}

export const precisionText = (p: PostedPrecision): string => PRECISION_TEXT[p];

const TRUST_TEXT: Record<string, string> = {
  verified: "We opened this link and the posting is live",
  "from employer": "Taken straight from the employer's own job board a moment ago",
  unverified: "Not opened yet; it comes from a list or aggregator",
  "link broken": "The posting is gone or the link no longer works",
};

export function TrustMark({ job }: { job: Job }) {
  const label = linkLabel(job);
  const kind = label === "verified" ? "ok" : label === "link broken" ? "dead" : label === "from employer" ? "employer" : "unknown";
  return (
    <span className={`trust ${kind}`} title={TRUST_TEXT[label]}>
      <span className="dot" aria-hidden="true" />
      {label}
    </span>
  );
}

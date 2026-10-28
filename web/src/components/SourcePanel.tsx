import type { SourceHealth } from "../lib/types";

function ago(iso: string | null, now: Date): string {
  if (!iso) return "never";
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (mins < 2) return "just now";
  if (mins < 120) return `${mins} min ago`;
  return mins < 2880 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
}

export function SourcePanel({ sources, now }: { sources: SourceHealth[]; now: Date }) {
  const bad = sources.filter((s) => s.status !== "ok").length;
  return (
    <details className="sources">
      <summary>
        {sources.length - bad} of {sources.length} sources up to date
        {bad > 0 && <span className="badge warn">{bad} need attention</span>}
      </summary>
      <table>
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Status</th>
            <th scope="col">Jobs kept</th>
            <th scope="col">Last success</th>
          </tr>
        </thead>
        <tbody>
          {[...sources].sort((a, b) => Number(a.status === "ok") - Number(b.status === "ok") || a.source.localeCompare(b.source)).map((s) => (
            <tr key={s.source} title={s.error}>
              <th scope="row">{s.source}</th>
              <td className={`status ${s.status}`}>{s.status === "ok" ? "Up to date" : s.status === "stale" ? "Showing earlier data" : "Not working yet"}</td>
              <td>{s.jobCount}</td>
              <td>{ago(s.lastSuccessAt, now)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

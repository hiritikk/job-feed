import { useCallback, useEffect, useMemo, useState } from "react";
import { FilterRail } from "./components/FilterRail";
import { JobDrawer } from "./components/JobDrawer";
import { JobRow } from "./components/JobRow";
import { PrecisionMark } from "./components/Marks";
import { SourcePanel } from "./components/SourcePanel";
import { DATA_URL, loadJobs, readApplied, readLastVisit, readRailHidden, toggleApplied, writeApplied, writeLastVisit, writeRailHidden } from "./lib/data";
import { activeFilterCount, applyFilters, defaultFilters, filtersToSearch, isNewSince, searchToFilters, type Filters } from "./lib/filters";
import type { Job, JobsFile } from "./lib/types";

const PAGE = 150;
const RELOAD_MS = 5 * 60_000;

type Load = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; file: JobsFile };

function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function App() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [filters, setFilters] = useState<Filters>(() => searchToFilters(window.location.search));
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Job | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [railHidden, setRailHidden] = useState(() => readRailHidden());
  const lastVisit = useMemo(() => readLastVisit(), []);
  const [applied, setApplied] = useState(() => readApplied());
  const now = useNow();

  const fetchJobs = useCallback(async () => {
    const res = await loadJobs(DATA_URL);
    setLoad((prev) => (res.ok ? { status: "ready", file: res.data } : prev.status === "ready" ? prev : { status: "error", error: res.error }));
  }, []);

  useEffect(() => {
    void fetchJobs();
    const id = setInterval(() => void fetchJobs(), RELOAD_MS);
    return () => clearInterval(id);
  }, [fetchJobs]);

  useEffect(() => {
    const save = () => writeLastVisit(new Date().toISOString());
    const onVisibility = () => document.visibilityState === "hidden" && save();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", save);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", save);
    };
  }, []);

  useEffect(() => {
    const search = filtersToSearch(filters);
    window.history.replaceState(null, "", search || window.location.pathname);
    setLimit(PAGE);
  }, [filters]);

  const jobs = load.status === "ready" ? load.file.jobs : [];
  const matches = useMemo(() => applyFilters(jobs, filters, now, applied), [jobs, filters, now, applied]);
  const sources = useMemo(() => [...new Set(jobs.flatMap((j) => j.sources))].sort(), [jobs]);
  const newCount = useMemo(() => matches.filter((j) => isNewSince(j, lastVisit)).length, [matches, lastVisit]);
  const closeDrawer = useCallback(() => setOpen(null), []);
  const onToggleApplied = useCallback((job: Job) => {
    setApplied((prev) => {
      const next = toggleApplied(prev, job.id, new Date().toISOString());
      writeApplied(next);
      return next;
    });
  }, []);
  const active = activeFilterCount(filters);
  const toggleFilters = () => {
    // wide screens: hide or show the side panel (remembered); narrow screens: open it as a full-screen sheet
    setRailHidden(!railHidden);
    writeRailHidden(!railHidden);
    setRailOpen(true);
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>Early-career jobs</h1>
          <p>
            {load.status === "ready" ? (
              <>
                <strong>{matches.length.toLocaleString()}</strong> {matches.length === 1 ? "job matches" : "jobs match"}
                {newCount > 0 && <span className="new-count">{newCount} new since your last visit</span>}
              </>
            ) : (
              "Loading the latest jobs"
            )}
          </p>
        </div>
        <label className="search">
          <span className="visually-hidden">Search title, company or city</span>
          <input type="search" placeholder="Search title, company or city" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        </label>
        <button type="button" className="filters-btn" aria-expanded={!railHidden} onClick={toggleFilters}>
          {railHidden ? "Show filters" : "Hide filters"}
          {active > 0 && <span className="count-pill">{active}</span>}
        </button>
      </header>

      <div className={railHidden ? "body no-rail" : "body"}>
        <FilterRail jobs={jobs} filters={filters} setFilters={setFilters} sources={sources} open={railOpen} onClose={() => setRailOpen(false)} matchCount={matches.length} />
        <main>
          {load.status === "loading" && <p className="state" role="status">Loading the latest jobs…</p>}
          {load.status === "error" && (
            <div className="state error" role="alert">
              <h2>The job list could not be loaded</h2>
              <p>{load.error}</p>
              <button type="button" onClick={() => void fetchJobs()}>Try again</button>
            </div>
          )}
          {load.status === "ready" && matches.length === 0 && (
            <div className="state">
              <h2>No jobs match these filters</h2>
              <p>{jobs.length === 0 ? "The feed is empty right now. The next refresh runs within 30 minutes." : "Widen the location, level or posting-date filters, or reset them."}</p>
              <button type="button" onClick={() => setFilters(defaultFilters())}>Reset filters</button>
            </div>
          )}
          {matches.length > 0 && (
            <>
              <ol className="rows">
                {matches.slice(0, limit).map((job) => (
                  <JobRow key={job.id} job={job} now={now} isNew={isNewSince(job, lastVisit)} applied={applied[job.id] ?? null} onOpen={setOpen} onToggleApplied={onToggleApplied} />
                ))}
              </ol>
              {matches.length > limit && (
                <button type="button" className="more" onClick={() => setLimit(limit + PAGE)}>
                  Show {Math.min(PAGE, matches.length - limit)} more of {matches.length - limit} remaining
                </button>
              )}
            </>
          )}
        </main>
      </div>
      {load.status === "ready" && (
        <footer className="about">
          <p>
            Updated {new Date(load.file.generatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}. Every job shows the date its source gives. A job with no date shows when this feed found it.
          </p>
          <details className="legend">
            <summary>How to read dates and links</summary>
            <ul>
              <li><PrecisionMark precision="exact" /> Exact posting time from the employer or source (shown as “3h ago”)</li>
              <li><PrecisionMark precision="day" /> Date only (shown as “Oct 22”)</li>
              <li><PrecisionMark precision="approx" /> Estimated from “N days ago” (shown with ~)</li>
              <li><PrecisionMark precision="none" /> No date published (shown as “found 2h ago”)</li>
              <li>Open a job to see how its link was checked. Broken links are hidden.</li>
            </ul>
          </details>
          <SourcePanel sources={load.file.sources} now={now} />
        </footer>
      )}
      {open && <JobDrawer job={open} now={now} applied={applied[open.id] ?? null} onClose={closeDrawer} onToggleApplied={onToggleApplied} />}
    </div>
  );
}

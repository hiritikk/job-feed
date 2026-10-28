import { useMemo, useState, type ReactNode } from "react";
import { cityOptions, defaultFilters, type Filters, type LocationKey } from "../lib/filters";
import type { Job, Level, RoleType, Tier } from "../lib/types";
import { linkOuts } from "../lib/linkouts";

type Props = { jobs: Job[]; filters: Filters; setFilters: (f: Filters) => void; sources: string[]; open: boolean; onClose: () => void; matchCount: number };

const LOCATIONS: [LocationKey, string][] = [["CA", "Canada"], ["REMOTE", "Remote"], ["US", "United States"], ["GB", "UK"], ["EU", "Europe"], ["OTHER", "Elsewhere"]];
const ROLES: [RoleType, string][] = [["sde", "Software"], ["ml-ai", "ML and AI"], ["backend", "Backend"], ["fullstack", "Full stack"], ["infra", "Infrastructure"], ["data", "Data"]];
const LEVELS: [Level, string][] = [["new-grad", "New grad"], ["early-career", "Early career"], ["other", "Level not stated"]];
const TIERS: [Tier, string, string][] = [[1, "Tier 1", "Big tech and top AI labs"], [2, "Tier 2", "Unicorns and strong Canadian employers"], [3, "Tier 3", "Other tech employers"]];
const DAYS: [Filters["postedWithinDays"], string][] = [[null, "Any time"], [1, "24 hours"], [3, "3 days"], [7, "7 days"], [30, "30 days"]];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="group">
      <legend>{title}</legend>
      {hint && <p className="hint">{hint}</p>}
      <div className="chips">{children}</div>
    </fieldset>
  );
}

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button type="button" className={on ? "chip on" : "chip"} aria-pressed={on} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

export function FilterRail({ jobs, filters, setFilters, sources, open, onClose, matchCount }: Props) {
  const [allCities, setAllCities] = useState(false);
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const cities = useMemo(() => cityOptions(jobs, filters.locations), [jobs, filters.locations]);
  const shown = allCities ? cities.slice(0, 80) : cities.slice(0, 8);
  const selectedHidden = filters.cities.filter((c) => !shown.some((s) => s.city === c));

  return (
    <aside className={open ? "rail open" : "rail"} aria-label="Filters">
      <div className="rail-head">
        <h2>Filters</h2>
        <button type="button" className="link" onClick={() => setFilters(defaultFilters())}>
          Reset
        </button>
        <button type="button" className="close-rail" onClick={onClose}>
          Show {matchCount} jobs
        </button>
      </div>

      <Group title="Where">
        {LOCATIONS.map(([key, label]) => (
          <Chip key={key} on={filters.locations.includes(key)} onClick={() => set({ locations: toggle(filters.locations, key) })}>
            {label}
          </Chip>
        ))}
      </Group>

      <Group title="City" hint={filters.locations.length ? "Cities in the places selected above" : "Most common cities"}>
        {[...selectedHidden.map((city) => ({ city, count: 0 })), ...shown].map(({ city, count }) => (
          <Chip key={city} on={filters.cities.includes(city)} onClick={() => set({ cities: toggle(filters.cities, city) })}>
            {city}
            {count > 0 && <span className="count">{count}</span>}
          </Chip>
        ))}
        {cities.length > 8 && (
          <button type="button" className="link" onClick={() => setAllCities(!allCities)}>
            {allCities ? "Fewer cities" : `${Math.min(cities.length, 80) - 8} more cities`}
          </button>
        )}
      </Group>

      <Group title="Level">
        {LEVELS.map(([key, label]) => (
          <Chip key={key} on={filters.levels.includes(key)} onClick={() => set({ levels: toggle(filters.levels, key) })}>
            {label}
          </Chip>
        ))}
      </Group>

      <Group title="Posted within">
        {DAYS.map(([days, label]) => (
          <Chip key={label} on={filters.postedWithinDays === days} onClick={() => set({ postedWithinDays: days })}>
            {label}
          </Chip>
        ))}
      </Group>

      <details className="more-filters">
        <summary>More filters</summary>
      <Group title="Class of" hint="Only postings that name a graduation year carry one">
        {([2026, 2027, 2028, "none"] as const).map((y) => (
          <Chip key={y} on={filters.gradYears.includes(y)} onClick={() => set({ gradYears: toggle(filters.gradYears, y) })}>
            {y === "none" ? "No year stated" : y}
          </Chip>
        ))}
      </Group>

      <Group title="Role">
        {ROLES.map(([key, label]) => (
          <Chip key={key} on={filters.roleTypes.includes(key)} onClick={() => set({ roleTypes: toggle(filters.roleTypes, key) })}>
            {label}
          </Chip>
        ))}
      </Group>

      <Group title="Company">
        {TIERS.map(([tier, label, title]) => (
          <Chip key={tier} on={filters.tiers.includes(tier)} title={title} onClick={() => set({ tiers: toggle(filters.tiers, tier) })}>
            {label}
          </Chip>
        ))}
      </Group>

      <Group title="Sort by">
        <Chip on={filters.sort === "posted"} onClick={() => set({ sort: "posted" })}>Posted date</Chip>
        <Chip on={filters.sort === "found"} onClick={() => set({ sort: "found" })}>When we found it</Chip>
      </Group>

      <fieldset className="group">
        <legend>Show</legend>
        <label className="check">
          <input type="checkbox" checked={filters.hideRestricted} onChange={(e) => set({ hideRestricted: e.target.checked })} />
          Hide postings that limit work authorization
        </label>
        <label className="check">
          <input type="checkbox" checked={filters.includeClosed} onChange={(e) => set({ includeClosed: e.target.checked })} />
          Include closed and broken links
        </label>
      </fieldset>

      <details className="group">
        <summary>Sources ({filters.sources.length || "all"})</summary>
        <div className="chips">
          {sources.map((s) => (
            <Chip key={s} on={filters.sources.includes(s)} onClick={() => set({ sources: toggle(filters.sources, s) })}>
              {s}
            </Chip>
          ))}
        </div>
      </details>

      <section className="group linkouts">
        <h3>Boards we can't read</h3>
        <p className="hint">These sites forbid automated reading. Each link opens their newest postings for your search.</p>
        <div className="chips">
          {linkOuts(filters.q).map((l) => (
            <a key={l.name} className="chip" href={l.url} target="_blank" rel="noopener noreferrer">
              {l.name}
            </a>
          ))}
        </div>
      </section>
      </details>
    </aside>
  );
}

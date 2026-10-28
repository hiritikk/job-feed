# Job Feed: Design Spec

Date: 2026-10-27
Status: Draft, awaiting user review

## 1. Purpose

A personal website that shows the latest tech job postings relevant to a software engineer graduating in **April 2027**, who is starting to apply now, and that sends a phone push the moment a strongly matching role appears.

**Success criteria**

- Opening the site shows postings no more than ~1 hour old from the major sources, deduplicated, with the newest first.
- A 2027 new-grad SDE role at a tier-1 company in Canada (or remote-Canada) reaches the user's iPhone within ~45 minutes of being published.
- The user can narrow the feed to what matters (Canada/remote, new-grad/2027, SDE or adjacent roles, tier 1-2 companies) in two clicks, and bookmark that view.
- One broken source never empties or corrupts the feed.

**Scope decisions (agreed)**

- Feed plus alerts. **No application tracker** (no applied/interviewing/rejected state).
- Alerts via **ntfy.sh** (iPhone push).
- Locations: Canada and remote always included; US, UK and Europe available through a UI filter.
- Roles: SDE plus adjacent engineering (ML/AI, backend, full-stack, infra/SRE, data engineering, applied science), each tagged by role type so the user can filter back to pure SDE. Internships and co-ops are out of scope.
- Architecture: **static data pipeline, no database** (approach A).

**Non-goals**

- Scraping LinkedIn, Indeed, Glassdoor or any site that forbids it. These appear as prefilled search link-outs only.
- Multi-user accounts, login, or per-user server state.
- Resume tailoring, auto-apply, or application tracking.

## 2. Architecture

```
GitHub Actions cron (~30 min)
  fetch adapters (parallel, isolated)
    -> normalize -> classify -> dedupe -> diff vs previous run
    -> write jobs.json + state.json  -> force-push to orphan `data` branch
    -> send ntfy alerts for new matches

Vercel (static Vite + React site)
  fetches jobs.json from raw.githubusercontent.com/<owner>/<repo>/data/jobs.json at runtime
```

The site never redeploys when data changes; only the `data` branch moves. The repo must be **public** so the raw URL works without a token. Secrets (the ntfy topic, API keys) live in GitHub Actions secrets and never in the repo or `jobs.json`.

**Tech:** TypeScript throughout, Node 24, `tsx` to run the pipeline, Vite + React for the site, Vitest for tests, YAML for config (`companies.yml`, `alerts.yml`).

**Repo layout**

```
pipeline/
  adapters/        one file per source family (greenhouse.ts, lever.ts, ashby.ts, workday.ts, ...)
  normalize.ts     Job schema + shared helpers
  classify.ts      role type, level, grad year, location, work-auth, tier
  dedupe.ts
  diff.ts          new / closed detection against previous state
  alerts.ts        rule matching + ntfy delivery
  run.ts           orchestrator
config/
  companies.yml    curated companies: name, ats, slug, tier
  alerts.yml       alert rules
  sources.yml      enabled aggregators / community lists
scripts/
  validate-companies.ts   checks every slug still resolves
web/               Vite + React app
tests/
  fixtures/        saved real API responses
.github/workflows/
  refresh.yml      cron + manual dispatch + keepalive
```

## 3. Sources

All endpoints below were called on 2026-10-27 and returned HTTP 200 unless noted.

### 3.1 Company ATS APIs (primary; freshest)

| ATS | Endpoint | Date field |
|---|---|---|
| Greenhouse | `GET boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true` | `first_published`, `updated_at` |
| Lever | `GET api.lever.co/v0/postings/{slug}?mode=json` | `createdAt` (ms) |
| Ashby | `GET api.ashbyhq.com/posting-api/job-board/{slug}` | `publishedAt` |
| Workday | `POST {tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` (paged, body `{limit, offset, searchText}`) | `postedOn` is relative text ("Posted 7 Days Ago"); the adapter converts it to an approximate date and marks it `postedApprox` |
| Workable | `GET apply.workable.com/api/v1/widget/accounts/{slug}` | per job |
| SmartRecruiters | `GET api.smartrecruiters.com/v1/companies/{id}/postings` | per job. Two guessed slugs returned 0 results, so every entry in `companies.yml` must be verified by the validator |

`companies.yml` is hand-curated (~300 companies at launch): big tech, top AI labs, well-funded startups, and strong Canadian employers. Each entry names its ATS, slug and tier. `scripts/validate-companies.ts` fails CI-visibly if a slug returns an error or zero jobs, so stale entries are caught.

### 3.2 Community new-grad lists

- `SimplifyJobs/New-Grad-Positions`: `.github/scripts/listings.json` (about 19k entries, ~3k active; structured locations, `sponsorship`, `degrees`, `category`, `date_posted`). Noisy (includes non-engineering roles), so classification filters it.
- `vanshb03/New-Grad-2027`, `speedyapply/2026-SWE-College-Jobs`, `hanzili/canada_sde_junior_new_grad_position` (Canada-specific), `jobright-ai/2026-Software-Engineer-New-Grad`: all active as of 2026-10-28. **Their machine-readable format has not been checked.** The implementation plan includes a task to inspect each one and either parse a JSON file or fall back to parsing the README table. A list whose format cannot be parsed reliably is dropped rather than half-supported.

### 3.3 Aggregators (keyless)

Remotive, RemoteOK, Jobicy, Himalayas (cursor pagination), Arbeitnow, The Muse (`level=Entry Level`), HN "Who is hiring" (Algolia: find the latest `author_whoishiring` thread, then read its comments). Remotive, RemoteOK and Jobicy require attribution and a link back, so the UI shows the source name on each card and links to the original.

### 3.4 Keyed aggregators (optional, free signup)

Adzuna (has a Canada endpoint; returned 401 without a key) and Jooble. Enabled only if the key is present in secrets; absent keys are skipped without error.

### 3.5 Link-out only

LinkedIn, Indeed, Glassdoor, Wellfound, Job Bank Canada: a row of buttons that open each site's search in a new tab with the user's current filters prefilled where the site's URL scheme allows it. No data is fetched from these.

## 4. Data model

```ts
type Job = {
  id: string;              // stable: hash of canonical url (or source+sourceId)
  company: string;
  title: string;
  url: string;             // canonical apply/posting URL
  locations: string[];     // raw location strings
  countries: ("CA"|"US"|"GB"|"EU"|"OTHER")[];
  remote: "remote" | "hybrid" | "onsite" | "unknown";
  remoteRegions: string[]; // e.g. ["CA","US"] when stated
  postedAt: string;        // ISO; best available
  postedApprox: boolean;   // true for Workday and sources with relative dates
  firstSeenAt: string;     // ISO; set by this pipeline, never changes
  lastSeenAt: string;
  closedAt: string | null;
  source: string;          // "greenhouse" | "lever" | ... | "simplify"
  sources: string[];       // all sources that carried this posting after dedupe
  roleType: "sde"|"ml-ai"|"backend"|"fullstack"|"infra"|"data"|"other";
  level: "new-grad"|"early-career"|"other";
  gradYear: 2026 | 2027 | 2028 | null;
  workAuth: "none" | "restricted" | "sponsors" | "unknown";
  tier: 1 | 2 | 3;
  snippet: string;         // plain-text, <= 400 chars
};
```

`jobs.json` is `{ generatedAt, sources: SourceHealth[], jobs: Job[] }`. `state.json` (same branch, not fetched by the site) holds seen ids and per-source last-success data for diffing.

## 5. Classification rules

Pure functions in `classify.ts`, driven by ordered regex rules and test-cased against real titles.

- **roleType:** keyword rules on title first (ML/AI/applied scientist, backend, full-stack, SRE/infra/platform/devops, data engineer, software engineer / SDE / developer -> `sde`). Anything else is `other` and is hidden by default.
- **level:**
  - `new-grad`: "new grad", "new college grad", "university grad", "graduate", "recent grad", "campus", "entry level", "SDE 1", "SWE I", "software engineer I", "associate" (engineering titles), "L3" at companies that map L3 to entry level.
  - `early-career`: "junior", "engineer II" with no senior/staff/lead markers, or description text stating 0-2 years.
  - Titles with senior/staff/principal/lead/manager/director are always `other`.
- **gradYear:** a 4-digit year 2026-2028 next to "new grad"/"graduate"/"start"/"class of". The user's target is **2027**. 2026 postings are kept and shown, tagged `2026`, but excluded from alerts by default. Postings with no year are treated as `null` (included in the feed, eligible for alerts).
- **countries / remote:** parsed from location strings and the structured fields that Ashby and Simplify provide ("Remote in Canada", "Toronto, ON", city lists). "Remote" with no region is `remote` with empty `remoteRegions`; the Canada filter includes it by default, and the UI can narrow to "remote (Canada eligible)".
- **workAuth:** `restricted` when the title/description contains US-citizenship, security-clearance or "must be authorized to work in the US without sponsorship" phrasing; `sponsors` when sponsorship is stated; Simplify's `sponsorship` field is mapped directly; otherwise `unknown`. This is a heuristic filter, not legal advice, and the UI says so.
- **tier:** looked up from `companies.yml`. Companies from aggregators or community lists that are not in the file are tier 3.

## 6. Dedupe and diff

- **Dedupe:** (1) exact canonical-URL match, with tracking parameters stripped; (2) otherwise a key of normalized company + normalized title + primary location. The record from a direct ATS adapter wins over community/aggregator copies; all contributing sources are kept in `sources`.
- **Diff:** a job is *new* if its id is not in the previous `state.json`; *closed* if its source fetched successfully this run and the id is absent. Closed jobs are kept for 7 days with `closedAt` set (shown greyed), then dropped.
- **Failure handling:** if a source errors, times out, or returns a suspicious drop (more than 60% fewer jobs than last run), that source's previous jobs are carried over unchanged and its health entry is marked `stale`. Nothing is marked closed for that source.

## 7. Alerts

`config/alerts.yml` holds a list of rules. Default rule:

```yaml
- name: core
  countries: [CA]            # includes remote roles whose remoteRegions include CA or are empty
  remote_ok: true
  levels: [new-grad, early-career]
  grad_years: [2027, null]
  role_types: [sde, ml-ai, backend, fullstack, infra, data]
  tiers: [1, 2]
  exclude_work_auth: [restricted]
  priority: { 1: high, 2: default }
```

- Evaluated only against *new* jobs from the diff.
- Delivery: HTTP POST to `https://ntfy.sh/<topic>` with title, company, location, tier, and a click action opening the posting URL. The topic is an unguessable string stored in the `NTFY_TOPIC` secret.
- If a run yields more than 5 matches, send one digest notification (counts plus the top 3 by tier) linking to the site, instead of 5+ separate pushes.
- The **first run** populates state without sending anything.
- If ntfy delivery fails, the job ids are not marked alerted, so the next run retries them.

## 8. Website

- **Layout:** header with total count, last-updated time, and a source-health indicator; left filter rail (collapses to a sheet on mobile); main list of job cards; detail drawer.
- **Filters:** location chips (Canada and Remote on by default; US, UK, Europe, Other toggles), role type, level, grad year, company tier, source, posted within (24h / 3d / 7d / 30d), hide work-auth restricted, include closed, free-text search over title and company.
- **Cards:** company, title, location and remote badge, tier badge, level and grad-year tags, relative posted time (`~` prefix when approximate), source label, and an Apply button.
- **New since last visit:** the last-visit timestamp is kept in `localStorage` (wrapped in try/catch); jobs with `firstSeenAt` after it get a "new" marker.
- **URL state:** all filters are serialized in the query string, so any view is bookmarkable and shareable.
- **Source-health panel:** per source, last success time, job count, and status (ok / stale / failed).
- **Link-out row:** LinkedIn, Indeed, Glassdoor, Wellfound, Job Bank Canada search buttons.
- **Visual design:** responsive down to phone width, light and dark themes, dense but readable list. Detailed visual treatment is decided at implementation time using the frontend design guidance.
- **Data loading:** one fetch of `jobs.json` (gzip served by GitHub raw), kept in memory, filtered client-side. Target is under 30k records. If it grows past that, the pipeline splits the file by region; this is not built now.

## 9. Operations and risks

- **Schedule:** cron every 30 minutes plus `workflow_dispatch` for manual runs. GitHub cron can be delayed by several minutes under load, which is accepted.
- **Inactivity:** GitHub disables scheduled workflows on public repos after 60 days without repo activity. The workflow includes a keepalive step that touches the repo on a monthly cadence.
- **Rate limits and etiquette:** requests use a descriptive User-Agent, per-host concurrency limits, and timeouts of 25s; Workday and large boards are paged. Aggregators are polled no more often than their published guidance.
- **Source ToS:** attribution is shown for sources that require it. LinkedIn, Indeed and Glassdoor are not fetched.
- **Secrets:** `NTFY_TOPIC`, optional `ADZUNA_APP_ID`/`ADZUNA_APP_KEY`/`JOOBLE_KEY`. None are committed.

## 10. Testing

- **Adapters:** each tested against a saved real response in `tests/fixtures/`, asserting the normalized output (id stability, dates, locations).
- **Classifier:** a table-driven corpus of real titles and locations (including "SDE 1", "University Grad 2027", "Associate SWE", "Remote in Canada", senior-title exclusions) with expected tags.
- **Dedupe/diff:** unit tests covering cross-source duplicates, source failure carry-over, and the 60% drop guard.
- **Alerts:** rule-matching tests; ntfy delivery tested with a mocked HTTP layer; first-run silence and digest batching asserted.
- **Companies validator:** run in CI on a weekly schedule.
- **Live smoke test:** a non-blocking script that hits one real endpoint per ATS to catch upstream format changes.
- **Web:** component tests for filter logic and URL-state round-tripping.

## 11. Open items for the implementation plan

1. Inspect the formats of the four non-Simplify community lists and decide which to include.
2. Build the first `companies.yml` seed (~300 entries) and verify each slug with the validator.
3. Confirm Workday tenant, site and `wd{N}` values for each Workday company in the seed list.
4. Decide whether to enable the keyed aggregators at launch (needs the user to create free Adzuna/Jooble keys).
5. Create the GitHub repo (public), the Vercel project, and the `NTFY_TOPIC` secret; the user subscribes to the topic in the ntfy iPhone app.

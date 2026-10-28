# Early-career job feed

A personal job feed for a software engineer graduating in April 2027. A scheduled job gathers postings from employers' own job boards, community new-grad lists and remote-job aggregators, classifies them, checks dates and links, and sends a phone alert (ntfy) when a strong match appears. A static website shows the result.

- Design: `docs/superpowers/specs/2026-10-27-job-feed-design.md`
- Plan: `docs/superpowers/plans/2026-10-27-job-feed.md`

## How it works

```
GitHub Actions (every 30 min)           Vercel (static site in web/)
  fetch -> classify -> dedupe -> diff     reads jobs.json from the data branch
  -> check links -> alert -> publish ---> raw.githubusercontent.com/<owner>/<repo>/data/jobs.json
```

- `pipeline/` fetches, classifies, de-duplicates, diffs and alerts. `config/companies.yml` lists ~320 employers (verified boards plus tier-only names), `config/alerts.yml` holds the alert rule, `config/sources.yml` switches sources on and off.
- Dates carry a precision (`exact`, `day`, `approx`, `none`); the site shows it next to every date and never invents one. "Found by this feed" is always exact.
- Links are absolute https URLs with tracking removed. Links from lists and aggregators are opened and checked (404/410 or a redirect to a generic page hides the job).
- Boards that forbid automated reading (LinkedIn, Indeed, Glassdoor, Wellfound, Job Bank) are not fetched; the site links to their searches. Pages that only serve real browsers (Tesla) are not supported, and the pipeline always identifies itself honestly.

## Commands

```
npm test                    # pipeline tests
npm --prefix web test       # site tests
npm run validate            # every company board still answers
npm run pipeline            # one full run into ./data (set NTFY_TOPIC to send alerts)
npm --prefix web run dev    # local site (put a jobs.json in web/public and set VITE_DATA_URL)
```

## Going live

1. Create a public GitHub repo and push `main` (the site reads the `data` branch through raw.githubusercontent.com, which needs a public repo).
2. Repo secrets: `NTFY_TOPIC` (a long random string, e.g. `jobs-<12 hex chars>`), optional `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JOOBLE_KEY`. Repo variable: `SITE_URL`.
3. Run the `refresh` workflow once. The first run publishes silently; later runs alert on new matches.
4. Deploy `web/` to Vercel (framework: Vite). In the ntfy iPhone app, subscribe to your topic.

## Known gaps

- Apple, Meta and Uber have no verified public endpoint yet, so they only appear through the community lists (their dates and links are less reliable).
- Microsoft's search returns only the newest page per query (page 2 is blocked for scripts).
- Workday boards expose only relative dates ("Posted 7 Days Ago"); those dates are shown as day precision or estimated.

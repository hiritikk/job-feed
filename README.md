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

- `pipeline/` fetches, classifies, de-duplicates, diffs and alerts. `config/companies.yml` lists ~510 employers (verified boards plus tier-only names, including a hand-picked list of large employers: Fortune 500, Global 500 and big Canadian corporations), `config/alerts.yml` holds the alert rule, `config/sources.yml` switches sources on and off.
- Dates carry a precision (`exact`, `day`, `approx`, `none`); the site shows it next to every date and never invents one. "Found by this feed" is always exact.
- Links are absolute https URLs with tracking removed. Links from lists and aggregators are opened and checked (404/410 or a redirect to a generic page hides the job).
- Boards that forbid automated reading (LinkedIn, Indeed, Glassdoor, Wellfound, Job Bank) are not fetched; the site links to their searches. Pages that only serve real browsers (Tesla) are not supported, and the pipeline always identifies itself honestly.

## Fit ratings (optional)

With an OpenRouter key, each new posting is also read by [JEV](https://openrouter.ai/typesafe/jev-1.13), a small decision model, to judge whether you can apply: real level, graduation window, advanced-degree and work-authorization requirements. The client and questions are adapted from [qbeka/jev-job-search](https://github.com/qbeka/jev-job-search) (MIT).

- `config/fit.yml` says who it rates for (graduation date, where you can work). `pipeline/jev.ts` is the client; `pipeline/fit.ts` holds the questions, the score and the per-run limits (400 ratings, $0.25).
- Each rated job gets `fit: { score, skip, reasons }`. The site shows it, sorts by it ("Best fit"), and alerts include it.
- Ratings only add alerts: the keyword rules ignore them, and the `high-fit` rule in `config/alerts.yml` alerts on postings at tier 1-2 companies that JEV reads as new-grad level (score 0.65 or more) though a number in the text made the keyword rules turn them away.
- Only postings found in the last 14 days are rated, once each. Without the key, or when JEV is unreachable, the run behaves exactly as before.
- Optional: a `FIT_PROFILE` secret (shape: `config/profile.example.json`) adds a skills match to the score. The scores and reasons are published in `jobs.json`, which is public.

```
gh secret set OPENROUTER_API_KEY     # paste the key when asked
```

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
2. Repo secrets: `NTFY_TOPIC` (a long random string, e.g. `jobs-<12 hex chars>`), optional `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JOOBLE_KEY`, and `OPENROUTER_API_KEY` for fit ratings. Repo variable: `SITE_URL`.
3. Run the `refresh` workflow once. The first run publishes silently; later runs alert on new matches.
4. Deploy `web/` to Vercel (framework: Vite). In the ntfy iPhone app, subscribe to your topic.

## Known gaps

- Uber and Tesla refuse automated readers (Uber answers 406 and its robots.txt disallows its API; Tesla answers 403), so they only appear through the community lists (their dates and links are less reliable). Apple is read directly from its search page; only the newest pages of its United States listings are read each run.
- Microsoft's search returns only the newest page per query (page 2 is blocked for scripts).
- Workday boards expose only relative dates ("Posted 7 Days Ago"); those dates are shown as day precision or estimated.

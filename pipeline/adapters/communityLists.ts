// Formats checked 2026-10-27:
//  - SimplifyJobs/New-Grad-Positions, vanshb03/New-Grad-2027: listings.json (see simplify.ts)
//  - speedyapply/2027-SWE-College-Jobs (renamed from 2026-SWE-College-Jobs), speedyapply/2027-AI-College-Jobs:
//    NEW_GRAD_USA.md + NEW_GRAD_INTL.md, HTML-in-markdown tables, age like "4d"; FAANG/Quant tables add a Salary column
//  (checked 2026-11-05)
//  - ambicuity/New-Grad-Jobs (MIT): the README shows 10 rows per category; the full list is the live board's jobs.json
//    (robots.txt allows all, ~4 MB gzipped, Cloudflare-cached for 4 h)
//  - ApplyGuy/2027-New-Grad-Jobs: data/new-grad-jobs.json, published as the repo's machine-readable feed
//  Not read: zapplyjobs/* (its README forbids resubmitting the listings to aggregators or feeds) and
//  DereC4/internships-and-newgrad (a re-aggregation of vanshb03 and zapplyjobs rows)
//  - hanzili/canada_sde_junior_new_grad_position: README.md, one table per category, no dates, Canada only
//  - jobright-ai/2026-Software-Engineer-New-Grad: README.md (branch master), rows link through jobright.ai, date like "Oct 27"
import { fetchSimplify, fetchVanshb03 } from "./simplify.js";
import type { Http, RawJob } from "../types.js";

const DAY = 86_400_000;
const rowCells = (line: string): string[] => line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
const isTableRow = (line: string): boolean => line.trimStart().startsWith("|") && !/^\s*\|[\s:|-]+\|\s*$/.test(line);

export function parseSpeedyApply(markdown: string, now: Date, source = "speedyapply"): RawJob[] {
  const out: RawJob[] = [];
  let lastCompany = "";
  for (const line of markdown.split("\n")) {
    if (!isTableRow(line)) continue;
    // Company | Position | Location | [Salary |] Posting | Age
    const cells = rowCells(line);
    const [companyCell, title, location] = cells;
    const applyCell = cells.at(-2);
    const age = cells.at(-1);
    if (cells.length < 5 || !applyCell || !/href=/.test(applyCell)) continue; // header and malformed rows
    const company = /<strong>(.*?)<\/strong>/.exec(companyCell)?.[1] ?? (companyCell.includes("↳") ? lastCompany : "");
    if (!company) continue;
    lastCompany = company;
    const url = /href="([^"]+)"/.exec(applyCell)![1];
    const m = /^(\d+)(h|d|w|mo)$/.exec(age ?? "");
    const unit = m ? { h: DAY / 24, d: DAY, w: 7 * DAY, mo: 30 * DAY }[m[2] as "h" | "d" | "w" | "mo"] : 0;
    out.push({
      source,
      sourceId: url,
      company,
      title,
      url,
      locations: [location.replace(/\s*\+\d+$/, "")],
      postedAt: m ? new Date(now.getTime() - Number(m[1]) * unit).toISOString() : null,
      // "4d" is accurate to the day; hours and months are not
      postedPrecision: m?.[2] === "d" ? "day" : "approx",
    });
  }
  return out;
}

export function parseHanzili(markdown: string): RawJob[] {
  const out: RawJob[] = [];
  for (const line of markdown.split("\n")) {
    if (!isTableRow(line)) continue;
    const [titleCell, company, role, info, , location, apply] = rowCells(line);
    const url = /\[Apply\]\(<?([^>\s)]+)>?\)/.exec(apply ?? "")?.[1];
    if (!url || !company) continue;
    const id = /<!--id:(\d+)-->/.exec(titleCell)?.[1];
    const title = titleCell.replace(/<!--.*?-->/g, "").replace(/[🔥💤🆕]/gu, "").trim();
    out.push({
      source: "hanzili",
      sourceId: id ?? url,
      company,
      title,
      url,
      locations: [/canada/i.test(location) ? location : `${location}, Canada`],
      postedAt: null,
      descriptionHtml: [role, info].filter(Boolean).join(". "),
    });
  }
  return out;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function parseJobright(markdown: string, now: Date): RawJob[] {
  const out: RawJob[] = [];
  let lastCompany = "";
  for (const line of markdown.split("\n")) {
    if (!isTableRow(line)) continue;
    const [companyCell, titleCell, location, workModel, dateText] = rowCells(line);
    const t = /\[([^\]]+)\]\(([^)]+)\)/.exec(titleCell ?? "");
    if (!t) continue; // header row
    const company = /\[([^\]]+)\]/.exec(companyCell)?.[1] ?? (companyCell.includes("↳") ? lastCompany : "");
    if (!company) continue;
    lastCompany = company;
    const d = /^([A-Za-z]{3})\w*\s+(\d{1,2})$/.exec(dateText ?? "");
    let postedAt: string | null = null;
    if (d && MONTHS.includes(d[1].toLowerCase())) {
      let at = Date.UTC(now.getUTCFullYear(), MONTHS.indexOf(d[1].toLowerCase()), Number(d[2]));
      if (at > now.getTime() + DAY) at = Date.UTC(now.getUTCFullYear() - 1, MONTHS.indexOf(d[1].toLowerCase()), Number(d[2]));
      postedAt = new Date(at).toISOString();
    }
    out.push({
      source: "jobright",
      sourceId: t[2],
      company,
      title: t[1],
      url: t[2],
      locations: [location],
      postedAt,
      postedPrecision: "day",
      remoteHint: /remote/i.test(workModel ?? "") ? true : undefined,
    });
  }
  return out;
}

const AMBICUITY_CATEGORIES = new Set([
  "software_engineering", "engineering", "backend", "frontend", "mobile", "infrastructure_sre", "security",
  "data_ml", "data_engineering", "hardware", "quant_finance",
]);
type AmbicuityJob = {
  id: string; company: string; title: string; location?: string; url: string; posted_at?: string | null;
  category?: { id?: string }; flags?: { no_sponsorship?: boolean; us_citizenship_required?: boolean }; is_closed?: boolean; description?: string;
};

/** jobs.json from ambicuity's live board. Non-engineering categories are dropped here to keep the payload small. */
export function parseAmbicuity(data: unknown): RawJob[] {
  const jobs = (data as { jobs?: unknown })?.jobs;
  if (!Array.isArray(jobs)) throw new Error("ambicuity: payload has no jobs array");
  return (jobs as AmbicuityJob[])
    .filter((j) => !j.is_closed && AMBICUITY_CATEGORIES.has(j.category?.id ?? ""))
    .map((j) => ({
      source: "ambicuity",
      sourceId: j.id,
      company: j.company,
      title: j.title,
      url: j.url,
      locations: (j.location ?? "").split(";").map((l) => l.trim()).filter(Boolean),
      postedAt: j.posted_at ?? null,
      // midnight UTC means the board only knew the date
      postedPrecision: /T00:00:00(\.0+)?Z$/.test(j.posted_at ?? "") ? "day" : "exact",
      descriptionHtml: j.description || undefined,
      sponsorshipHint: j.flags?.us_citizenship_required ? "U.S. citizenship is required" : j.flags?.no_sponsorship ? "Does not offer sponsorship" : undefined,
    }));
}

type ApplyGuyJob = { id: string; company: string; title: string; location?: string; posted?: string; url: string; listingUrl?: string };

/** ApplyGuy's feed. `url` is their tracked apply page; `listingUrl` is the employer's own posting, which is preferred. */
export function parseApplyGuy(data: unknown): RawJob[] {
  const jobs = (data as { jobs?: unknown })?.jobs;
  if (!Array.isArray(jobs)) throw new Error("applyguy: payload has no jobs array");
  return (jobs as ApplyGuyJob[]).map((j) => {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(j.posted ?? "") ? `${j.posted}T00:00:00.000Z` : null;
    return {
      source: "applyguy",
      sourceId: j.id,
      company: j.company,
      title: j.title,
      url: j.listingUrl || j.url,
      locations: j.location ? [j.location] : [],
      postedAt: day,
      postedPrecision: "day",
    };
  });
}

const RAW = "https://raw.githubusercontent.com";

/** One entry per list so the orchestrator can track each as its own source (one failing never hides the rest). */
export function communityAdapters(http: Http, now = new Date()): Record<string, () => Promise<RawJob[]>> {
  const speedy = async (repo: string, source: string): Promise<RawJob[]> => {
    const files = ["NEW_GRAD_USA.md", "NEW_GRAD_INTL.md"];
    const pages = await Promise.all(files.map((f) => http.text(`${RAW}/speedyapply/${repo}/main/${f}`)));
    return pages.flatMap((p) => parseSpeedyApply(p, now, source));
  };
  return {
    simplify: () => fetchSimplify(http),
    vanshb03: () => fetchVanshb03(http),
    speedyapply: () => speedy("2027-SWE-College-Jobs", "speedyapply"),
    speedyapply_ai: () => speedy("2027-AI-College-Jobs", "speedyapply_ai"),
    hanzili: async () => parseHanzili(await http.text(`${RAW}/hanzili/canada_sde_junior_new_grad_position/main/README.md`)),
    jobright: async () => parseJobright(await http.text(`${RAW}/jobright-ai/2026-Software-Engineer-New-Grad/master/README.md`), now),
    ambicuity: async () => parseAmbicuity(await http.json("https://jobs.riteshrana.engineer/jobs.json")),
    applyguy: async () => parseApplyGuy(await http.json(`${RAW}/ApplyGuy/2027-New-Grad-Jobs/main/data/new-grad-jobs.json`)),
  };
}

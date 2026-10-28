// Formats checked 2026-10-27:
//  - SimplifyJobs/New-Grad-Positions, vanshb03/New-Grad-2027: listings.json (see simplify.ts)
//  - speedyapply/2026-SWE-College-Jobs: NEW_GRAD_USA.md + NEW_GRAD_INTL.md, HTML-in-markdown tables, age like "4d"
//  - hanzili/canada_sde_junior_new_grad_position: README.md, one table per category, no dates, Canada only
//  - jobright-ai/2026-Software-Engineer-New-Grad: README.md (branch master), rows link through jobright.ai, date like "Oct 27"
import { fetchSimplify, fetchVanshb03 } from "./simplify.js";
import type { Http, RawJob } from "../types.js";

const DAY = 86_400_000;
const rowCells = (line: string): string[] => line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
const isTableRow = (line: string): boolean => line.trimStart().startsWith("|") && !/^\s*\|[\s:|-]+\|\s*$/.test(line);

export function parseSpeedyApply(markdown: string, now: Date): RawJob[] {
  const out: RawJob[] = [];
  let lastCompany = "";
  for (const line of markdown.split("\n")) {
    if (!isTableRow(line)) continue;
    const [companyCell, title, location, applyCell, age] = rowCells(line);
    if (!applyCell || !/href=/.test(applyCell)) continue; // header and malformed rows
    const company = /<strong>(.*?)<\/strong>/.exec(companyCell)?.[1] ?? (companyCell.includes("↳") ? lastCompany : "");
    if (!company) continue;
    lastCompany = company;
    const url = /href="([^"]+)"/.exec(applyCell)![1];
    const m = /^(\d+)(h|d|w|mo)$/.exec(age ?? "");
    const unit = m ? { h: DAY / 24, d: DAY, w: 7 * DAY, mo: 30 * DAY }[m[2] as "h" | "d" | "w" | "mo"] : 0;
    out.push({
      source: "speedyapply",
      sourceId: url,
      company,
      title,
      url,
      locations: [location.replace(/\s*\+\d+$/, "")],
      postedAt: m ? new Date(now.getTime() - Number(m[1]) * unit).toISOString() : null,
      postedApprox: true,
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

const RAW = "https://raw.githubusercontent.com";

/** One entry per list so the orchestrator can track each as its own source (one failing never hides the rest). */
export function communityAdapters(http: Http, now = new Date()): Record<string, () => Promise<RawJob[]>> {
  return {
    simplify: () => fetchSimplify(http),
    vanshb03: () => fetchVanshb03(http),
    speedyapply: async () => {
      const files = ["NEW_GRAD_USA.md", "NEW_GRAD_INTL.md"];
      const pages = await Promise.all(files.map((f) => http.text(`${RAW}/speedyapply/2026-SWE-College-Jobs/main/${f}`)));
      return pages.flatMap((p) => parseSpeedyApply(p, now));
    },
    hanzili: async () => parseHanzili(await http.text(`${RAW}/hanzili/canada_sde_junior_new_grad_position/main/README.md`)),
    jobright: async () => parseJobright(await http.text(`${RAW}/jobright-ai/2026-Software-Engineer-New-Grad/master/README.md`), now),
  };
}

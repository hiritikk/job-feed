import { parseCities, parseLocations } from "./location.js";
import { stableId, stripTracking, toSnippet } from "./normalize.js";
import type { Job, Level, PostedPrecision, RawJob, RoleType, Tier, WorkAuth } from "./types.js";

const INTERN = /\b(intern(ship)?s?|co-?ops?|apprentice(ship)?s?)\b/i;
export const isInternship = (title: string): boolean => INTERN.test(title);

export function classifyRoleType(title: string): RoleType {
  if (/\b(machine learning|ml|artificial intelligence|applied scientist|research (engineer|scientist)|deep learning|nlp|llm|computer vision|data scientist)\b/i.test(title) || /\bAI\b/.test(title)) return "ml-ai";
  if (/\bdata (engineer|platform|infrastructure)|analytics engineer|data engineering\b/i.test(title)) return "data";
  if (/\b(site reliability|sre|devops|infrastructure|platform engineer|cloud engineer|systems engineer|production engineer)\b/i.test(title)) return "infra";
  if (/full[\s-]?stack/i.test(title)) return "fullstack";
  if (/back[\s-]?end|server[\s-]?side/i.test(title)) return "backend";
  if (/\b(software|sde|swe|sdet|developer|programmer)\b|front[\s-]?end|\b(ios|android|mobile)\b engineer|web developer|member of technical staff|\b(security|qa|quality assurance|firmware|embedded|release|build|test automation)\s+engineer/i.test(title)) return "sde";
  return "other";
}

const SENIOR = /\b(senior|sr\.?|staff|principal|lead|manager|director|head of|vp|architect|distinguished|fellow)\b/i;
const NEW_GRAD = /\b(new[\s-]?grad(uate)?s?|new college grad|university grad(uate)?s?|recent grad(uate)?s?|college grad(uate)?s?|campus|entry[\s-]?level|graduates?(?! (student|school|degree|research)))\b|\b(sde|swe|sdet)\s*(1|i)\b|\bsoftware (development )?engineer\s*(1|i)\b|\bassociate\b.*\b(engineer|developer|sde|swe)\b/i;
const EARLY = /\b(junior|jr\.?|early[\s-]?careers?)\b|\b(0|1)\s*(-|to)\s*2\s*years\b/i;
// "Engineer II", "SDE 2", "Data Scientist III": a level that usually asks for 2+ years of full-time work.
const MID_LEVEL = /\b(engineer|developer|sde|swe|sdet|scientist|programmer)\s*(ii|iii|iv|2|3|4)\b/i;

/** A numbered level of II or above, unless the title also says new grad, junior or early career. */
export const isMidLevelTitle = (title: string): boolean => MID_LEVEL.test(title) && !NEW_GRAD.test(title) && !EARLY.test(title);

/** Titles that mark a role as senior; these are dropped at ingest because they are never relevant to a new-grad search. */
export const isSenior = (title: string): boolean => SENIOR.test(title);

export function classifyLevel(title: string, description = ""): Level {
  if (SENIOR.test(title)) return "other";
  if (NEW_GRAD.test(title)) return "new-grad";
  if (EARLY.test(title)) return "early-career";
  if (/\b(0|1)\s*(-|to)\s*2\s*years\b/i.test(description)) return "early-career";
  return "other";
}

/** The smallest number of years of experience the posting asks for, or null when it states none ("5+ years of experience" -> 5). */
export function classifyYearsRequired(text: string): number | null {
  const found: number[] = [];
  for (const m of text.matchAll(/(\d{1,2})(?:\s*(?:-|–|to)\s*\d{1,2})?\s*\+?\s*years?\b/gi)) {
    const around = text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 60);
    if (/experience/i.test(around)) found.push(Number(m[1])); // "10 years in business" is not a requirement
  }
  return found.length > 0 ? Math.min(...found) : null;
}

const GRAD_TERMS = /(new[\s-]?grad|graduate|college grad|university grad|class of|start|campus)/i;

export function classifyGradYear(title: string, description = ""): 2026 | 2027 | 2028 | null {
  const t = /\b(2026|2027|2028)\b/.exec(title);
  if (t && GRAD_TERMS.test(title)) return Number(t[1]) as 2026 | 2027 | 2028;
  // Every graduation year the description ties to the degree; when several are named ("class of 2026 or 2027") the latest wins,
  // so a posting is only ruled out when no year it accepts is late enough.
  const years: number[] = [];
  for (const re of [GRAD_IN_TEXT, DEGREE_DEADLINE]) {
    for (const m of description.matchAll(re)) for (const y of m[0].matchAll(/\b(2026|2027|2028)\b/g)) years.push(Number(y[1]));
  }
  return years.length > 0 ? (Math.max(...years) as 2026 | 2027 | 2028) : null;
}

const GRAD_IN_TEXT = /class of (2026|2027|2028)\b(\s*(or|and|,|-|–|to)\s*(2026|2027|2028)\b)?|graduat\w*[^.]{0,40}\b(2026|2027|2028)\b/gi;
const WHEN = String.raw`(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?|spring|summer|fall|autumn|winter)?\s*(?:\d{1,2}(?:st|nd|rd|th)?,?\s+)?`;
// "degree ... obtained by summer 2026", "degree completed before December 2026"
const DEGREE_DEADLINE = new RegExp(String.raw`\b(?:degree|bachelor|master|diploma)[^.]{0,90}?\b(?:obtained|completed|conferred|earned|received|finished)\s+(?:by|before|no later than|prior to)\s+(?:the\s+)?${WHEN}(2026|2027|2028)\b`, "gi");

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  spring: "03", summer: "06", fall: "09", autumn: "09", winter: "12",
};
const START_BY = new RegExp(String.raw`\b(?:start|begin|commence)\w*\b[^.;:]{0,40}?\b(before|by|no later than|prior to)\s+(?:the\s+)?(?:([a-z]+)\.?\s+)?(?:\d{1,2}(?:st|nd|rd|th)?,?\s+)?(20\d\d)\b|\bstart date\s*(?:is|:|of)\s*([a-z]+)\.?\s+(?:\d{1,2}(?:st|nd|rd|th)?,?\s+)?(20\d\d)\b`, "i");

/**
 * The latest month (YYYY-MM) the posting lets you start in, or null when it states none. "Start before December 1, 2026"
 * -> 2026-12, "Start date: January 2027" -> 2027-01. A bare year counts as its last month ("start by 2027" -> 2027-12),
 * except after "before" ("before 2027" -> 2027-01), so an unclear date never rules a posting out.
 */
export function classifyStartBy(text: string): string | null {
  const m = START_BY.exec(text);
  if (!m) return null;
  const [word, monthWord, year] = m[3] ? [m[1].toLowerCase(), m[2], m[3]] : ["by", m[4], m[5]];
  const lower = monthWord?.toLowerCase();
  const month = lower ? MONTHS[lower] ?? MONTHS[lower.slice(0, 3)] : undefined;
  if (monthWord && !month) return null; // "start before the end of 2026" style wording we do not read
  return `${year}-${month ?? (word === "before" ? "01" : "12")}`;
}

// Real limits: citizenship or clearance requirements. A job like this may be closed to the user even in Canada.
const RESTRICTED = /(active|current|top[\s-]secret|ts\/sci|secret)\s+(security\s+)?clearance|u\.?s\.? citizen(ship)?\s*(is\s*)?(required|only)|must be a u\.?s\.? citizen/i;
// "No visa sponsorship" is not a limit for someone already allowed to work in the country, so it is tracked separately.
const NO_SPONSORSHIP = /(will not|cannot|can't|unable to|not able to|do not|does not|don't)\s+(offer|provide|sponsor)\w*[^.]{0,30}(visa|sponsorship|work authorization)|(does not|do not|don't)\s+sponsor|without (visa )?sponsorship|sponsorship\s+(is\s+)?not\s+(available|offered|provided)/i;
const SPONSORS = /\b(we|will|can)\s+(offer\s+|provide\s+)?(visa\s+)?sponsor\w*|sponsorship\s+(is\s+)?(available|provided|offered)/i;

export function classifyWorkAuth(text: string, sponsorshipHint?: string): WorkAuth {
  if (sponsorshipHint) {
    if (/citizenship is required/i.test(sponsorshipHint)) return "restricted";
    if (/does not offer|not offer/i.test(sponsorshipHint)) return RESTRICTED.test(text) ? "restricted" : "no-sponsorship";
    if (/^offers sponsorship/i.test(sponsorshipHint)) return "sponsors";
  }
  if (RESTRICTED.test(text)) return "restricted";
  if (NO_SPONSORSHIP.test(text)) return "no-sponsorship";
  if (SPONSORS.test(text)) return "sponsors";
  return "unknown";
}

/** Absolute https URL or null. http is upgraded; relative, empty and non-web schemes are rejected. */
export function cleanUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === "http:") u.protocol = "https:";
    else if (u.protocol !== "https:") return null;
    return stripTracking(u.toString());
  } catch {
    return null;
  }
}

export function classify(raw: RawJob, tierOf: (company: string) => Tier, now: Date): Job | null {
  if (isInternship(raw.title)) return null;
  const url = cleanUrl(raw.url);
  if (!url) return null;
  const text = toSnippet(raw.descriptionHtml ?? "", 20000);
  const loc = parseLocations(raw.locations, raw.remoteHint);
  const parsed = raw.postedAt ? new Date(raw.postedAt) : null;
  const valid = parsed !== null && !Number.isNaN(parsed.getTime());
  const precision: PostedPrecision = !valid ? "none" : raw.postedPrecision ?? (raw.postedApprox ? "approx" : "exact");
  return {
    id: stableId(raw.source, raw.sourceId, raw.url),
    company: raw.company,
    title: raw.title,
    url,
    locations: raw.locations,
    countries: loc.countries,
    cities: parseCities(raw.locations),
    remote: loc.remote,
    remoteRegions: loc.remoteRegions,
    postedAt: valid ? parsed.toISOString() : now.toISOString(),
    postedApprox: precision === "approx" || precision === "none",
    postedPrecision: precision,
    firstSeenAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    closedAt: null,
    linkStatus: "unknown",
    linkCheckedAt: null,
    resolvedUrl: null,
    source: raw.source,
    sources: [raw.source],
    roleType: classifyRoleType(raw.title),
    level: classifyLevel(raw.title, text),
    gradYear: classifyGradYear(raw.title, text),
    yearsRequired: classifyYearsRequired(text),
    startBy: classifyStartBy(text),
    workAuth: classifyWorkAuth(`${raw.title} ${text}`, raw.sponsorshipHint),
    tier: tierOf(raw.company),
    snippet: toSnippet(raw.descriptionHtml ?? "", 400),
  };
}

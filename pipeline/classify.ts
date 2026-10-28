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
const NEW_GRAD = /\b(new[\s-]?grad(uate)?s?|new college grad|university grad(uate)?s?|recent grad(uate)?s?|college grad(uate)?s?|campus|entry[\s-]?level|graduate (software|engineer|developer|program|scheme))\b|\b(sde|swe|sdet)\s*(1|i)\b|\bsoftware (development )?engineer\s*(1|i)\b|\bassociate\b.*\b(engineer|developer|sde|swe)\b/i;
const EARLY = /\b(junior|jr\.?|early[\s-]?careers?)\b|\b(software|backend|frontend|full[\s-]?stack)?\s*(engineer|developer|sde|swe)\s*(2|ii)\b|\b(0|1)\s*(-|to)\s*2\s*years\b/i;

export function classifyLevel(title: string, description = ""): Level {
  if (SENIOR.test(title)) return "other";
  if (NEW_GRAD.test(title)) return "new-grad";
  if (EARLY.test(title)) return "early-career";
  if (/\b(0|1)\s*(-|to)\s*2\s*years\b/i.test(description)) return "early-career";
  return "other";
}

const GRAD_TERMS = /(new[\s-]?grad|graduate|college grad|university grad|class of|start|campus)/i;

export function classifyGradYear(title: string, description = ""): 2026 | 2027 | 2028 | null {
  const t = /\b(2026|2027|2028)\b/.exec(title);
  if (t && GRAD_TERMS.test(title)) return Number(t[1]) as 2026 | 2027 | 2028;
  const d = /class of (2026|2027|2028)\b|graduat\w*[^.]{0,40}\b(2026|2027|2028)\b/i.exec(description);
  if (d) return Number(d[1] ?? d[2]) as 2026 | 2027 | 2028;
  return null;
}

const RESTRICTED = /(active|current|top[\s-]secret|ts\/sci|secret)\s+(security\s+)?clearance|u\.?s\.? citizen(ship)?\s*(is\s*)?(required|only)|must be a u\.?s\.? citizen|(will not|cannot|unable to|not able to|do not|does not|don't)\s+(offer|provide|sponsor)\w*[^.]{0,30}(visa|sponsorship|work authorization)|(does not|do not|don't)\s+sponsor|without (visa )?sponsorship/i;
const SPONSORS = /\b(we|will|can)\s+(offer\s+|provide\s+)?(visa\s+)?sponsor\w*|sponsorship\s+(is\s+)?(available|provided|offered)/i;

export function classifyWorkAuth(text: string, sponsorshipHint?: string): WorkAuth {
  if (sponsorshipHint) {
    if (/does not offer|citizenship is required|not offer/i.test(sponsorshipHint)) return "restricted";
    if (/^offers sponsorship/i.test(sponsorshipHint)) return "sponsors";
  }
  if (RESTRICTED.test(text)) return "restricted";
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
    workAuth: classifyWorkAuth(`${raw.title} ${text}`, raw.sponsorshipHint),
    tier: tierOf(raw.company),
    snippet: toSnippet(raw.descriptionHtml ?? "", 400),
  };
}

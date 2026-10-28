import { createHash } from "node:crypto";

const TRACKING = /^(utm_.*|gh_src|lever-source|lever-origin|ref|source|src|fbclid|gclid)$/i;

export function canonicalUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
  let out = u.toString();
  if (u.pathname.length > 1 && u.pathname.endsWith("/") && !u.search) out = out.replace(/\/$/, "");
  else if (u.pathname.length > 1 && u.pathname.endsWith("/")) out = out.replace(/\/\?/, "?");
  return out;
}

export function stableId(source: string, sourceId: string, url: string): string {
  if (!url) return `${source}:${sourceId}`;
  return createHash("sha1").update(canonicalUrl(url)).digest("hex");
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", hellip: "…",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function toSnippet(html: string, max = 400): string {
  // Decode first: Greenhouse returns entity-encoded HTML ("&lt;p&gt;"), so tags only appear after decoding.
  const text = decodeEntities(decodeEntities(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

/** ISO-8601 UTC string for a date-like value, or null when it is missing or unparseable. */
export function toIso(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  // "2026-10-22T18:40:19" has no designator and JS would read it as local time; every source we use means UTC.
  const text = typeof value === "string" && /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

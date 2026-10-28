import type { Country, RemoteMode } from "./types.js";

const CA_CITIES = /\b(toronto|vancouver|montr[eé]al|ottawa|waterloo|calgary|edmonton|kitchener|mississauga|markham|halifax|winnipeg|quebec|burnaby|richmond hill|oakville|guelph)\b/i;
const CA_WORDS = /\b(canada|ontario|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick)\b/i;
const CA_CODES = /,\s*(ON|BC|AB|QC)\b/;
const US_STATE = /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/;
const US_WORDS = /\b(united states|usa|u\.s\.a?\.?)\b|\bUS\b/i;
const US_CITIES = /\b(new york|san francisco|seattle|austin|boston|los angeles|chicago|san jose|mountain view|palo alto|sunnyvale|menlo park|redmond|cupertino|bellevue|atlanta|denver|pittsburgh|san diego)\b/i;
const GB = /\b(united kingdom|england|scotland|wales|northern ireland|london|manchester|edinburgh)\b|\bUK\b/;
const EU = /\b(europe|emea|germany|france|netherlands|spain|italy|ireland|dublin|berlin|munich|paris|amsterdam|madrid|barcelona|stockholm|sweden|poland|warsaw|portugal|lisbon|belgium|brussels|austria|vienna|denmark|copenhagen|finland|helsinki|switzerland|zurich|norway|czech|prague|romania|estonia|lithuania)\b/i;

const ORDER: Country[] = ["CA", "US", "GB", "EU", "OTHER"];

function countriesIn(s: string): Country[] {
  const found = new Set<Country>();
  const isCa = CA_CITIES.test(s) || CA_WORDS.test(s) || CA_CODES.test(s);
  if (isCa) found.add("CA");
  // "CA" after a comma is California unless the string is already Canadian.
  const stateMatch = US_STATE.exec(s);
  if (US_WORDS.test(s) || US_CITIES.test(s) || (stateMatch && !(isCa && stateMatch[1] === "CA"))) found.add("US");
  if (GB.test(s)) found.add("GB");
  if (EU.test(s)) found.add("EU");
  return [...found];
}

export function parseLocations(
  locations: string[],
  remoteHint?: boolean,
): { countries: Country[]; remote: RemoteMode; remoteRegions: string[] } {
  const countries = new Set<Country>();
  const regions = new Set<string>();
  let remote = false;
  let hybrid = false;

  for (const s of locations) {
    const isRemote = /\bremote\b/i.test(s);
    const isHybrid = /\bhybrid\b/i.test(s);
    remote ||= isRemote;
    hybrid ||= isHybrid;
    const found = countriesIn(s);
    for (const c of found) countries.add(c);
    if (isRemote) for (const c of found) regions.add(c);
    if (found.length === 0) {
      const rest = s.replace(/\b(remote|hybrid|on-?site|anywhere|worldwide)\b/gi, "").replace(/[\s\-–—,()/|]+/g, "");
      if (rest) {
        countries.add("OTHER");
        if (isRemote) regions.add("OTHER"); // a named but unrecognised region ("Remote - APAC") is not "region unspecified"
      }
    }
  }

  const mode: RemoteMode = remote || remoteHint ? "remote" : hybrid ? "hybrid" : "unknown";
  return {
    countries: ORDER.filter((c) => countries.has(c)),
    remote: mode,
    remoteRegions: ORDER.filter((c) => regions.has(c)),
  };
}

const CITY_TABLE: [RegExp, string][] = [
  [/\btoronto\b/i, "Toronto"], [/\bvancouver\b/i, "Vancouver"], [/\bmontr[eé]al\b/i, "Montreal"], [/\bottawa\b/i, "Ottawa"],
  [/\bwaterloo\b/i, "Waterloo"], [/\bkitchener\b/i, "Kitchener"], [/\bcalgary\b/i, "Calgary"], [/\bedmonton\b/i, "Edmonton"],
  [/\bmississauga\b/i, "Mississauga"], [/\bmarkham\b/i, "Markham"], [/\bhalifax\b/i, "Halifax"], [/\bwinnipeg\b/i, "Winnipeg"],
  [/\bburnaby\b/i, "Burnaby"], [/\bqu[eé]bec city\b/i, "Quebec City"],
  [/\bnew york\b|\bnyc\b/i, "New York"], [/\bsan francisco\b/i, "San Francisco"], [/\bseattle\b/i, "Seattle"], [/\baustin\b/i, "Austin"],
  [/\bboston\b/i, "Boston"], [/\blos angeles\b/i, "Los Angeles"], [/\bchicago\b/i, "Chicago"], [/\bsan jose\b/i, "San Jose"],
  [/\bmountain view\b/i, "Mountain View"], [/\bpalo alto\b/i, "Palo Alto"], [/\bsunnyvale\b/i, "Sunnyvale"], [/\bmenlo park\b/i, "Menlo Park"],
  [/\bredmond\b/i, "Redmond"], [/\bcupertino\b/i, "Cupertino"], [/\bbellevue\b/i, "Bellevue"], [/\batlanta\b/i, "Atlanta"],
  [/\bdenver\b/i, "Denver"], [/\bpittsburgh\b/i, "Pittsburgh"], [/\bsan diego\b/i, "San Diego"],
  [/\blondon\b/i, "London"], [/\bmanchester\b/i, "Manchester"], [/\bedinburgh\b/i, "Edinburgh"], [/\bdublin\b/i, "Dublin"],
  [/\bberlin\b/i, "Berlin"], [/\bmunich\b/i, "Munich"], [/\bparis\b/i, "Paris"], [/\bamsterdam\b/i, "Amsterdam"],
  [/\bmadrid\b/i, "Madrid"], [/\bbarcelona\b/i, "Barcelona"], [/\bstockholm\b/i, "Stockholm"], [/\bzurich\b/i, "Zurich"],
];
const NOT_A_CITY = /remote|hybrid|anywhere|worldwide|\bcanada\b|united states|\busa?\b|\buk\b|europe|emea|apac|north america|ontario|british columbia|alberta|quebec|manitoba|saskatchewan|nova scotia|new brunswick|^greater\b/i;

/** Canonical city names for the location filter (known cities first, then the first comma segment of unknown places). */
export function parseCities(locations: string[]): string[] {
  const out = new Set<string>();
  for (const s of locations) {
    const known = CITY_TABLE.filter(([re]) => re.test(s)).map(([, name]) => name);
    if (known.length > 0) {
      for (const k of known) out.add(k);
      continue;
    }
    const cleaned = s.replace(/\(.*?\)/g, "").replace(/^\s*(hybrid|onsite|on-site|remote)\s*[-–—:]\s*/i, "").replace(/\s*\+\d+\s*$/, "").trim();
    const first = cleaned.split(",")[0].trim();
    if (first && first.length <= 30 && !NOT_A_CITY.test(first)) out.add(first);
  }
  return [...out];
}

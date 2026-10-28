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

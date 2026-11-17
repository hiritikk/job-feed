import { describe, test, expect } from "vitest";
import { parseCities, parseLocations } from "../pipeline/location.js";

const cases: [string, string[], boolean | undefined, { countries: string[]; remote: string; remoteRegions: string[] }][] = [
  ["Toronto, ON", ["Toronto, ON"], undefined, { countries: ["CA"], remote: "unknown", remoteRegions: [] }],
  ["San Francisco, CA is US not Canada", ["San Francisco, CA"], undefined, { countries: ["US"], remote: "unknown", remoteRegions: [] }],
  ["Remote in Canada", ["Remote in Canada"], undefined, { countries: ["CA"], remote: "remote", remoteRegions: ["CA"] }],
  ["Remote - US", ["Remote - US"], undefined, { countries: ["US"], remote: "remote", remoteRegions: ["US"] }],
  ["bare Remote", ["Remote"], undefined, { countries: [], remote: "remote", remoteRegions: [] }],
  ["London + Berlin", ["London, UK", "Berlin, Germany"], undefined, { countries: ["GB", "EU"], remote: "unknown", remoteRegions: [] }],
  ["Vancouver + New York", ["Vancouver, BC, Canada", "New York, NY"], undefined, { countries: ["CA", "US"], remote: "unknown", remoteRegions: [] }],
  ["Vancouver, WA is the American one", ["Vancouver, WA, United States"], undefined, { countries: ["US"], remote: "unknown", remoteRegions: [] }],
  ["Waterloo, IA is the American one", ["Waterloo, IA"], undefined, { countries: ["US"], remote: "unknown", remoteRegions: [] }],
  ["Vancouver, BC stays Canadian", ["Vancouver, BC"], undefined, { countries: ["CA"], remote: "unknown", remoteRegions: [] }],
  ["remote by the source's flag, listed under a country, is remote in that country", ["United States"], true, { countries: ["US"], remote: "remote", remoteRegions: ["US"] }],
  ["remote by the source's flag, listed under Poland", ["Poland"], true, { countries: ["EU"], remote: "remote", remoteRegions: ["EU"] }],
  ["a Remote entry next to a Canadian office is remote in Canada", ["Remote", "Toronto, ON"], undefined, { countries: ["CA"], remote: "remote", remoteRegions: ["CA"] }],
  ["Hybrid Waterloo", ["Hybrid - Waterloo"], undefined, { countries: ["CA"], remote: "hybrid", remoteRegions: [] }],
  ["empty with remoteHint", [], true, { countries: [], remote: "remote", remoteRegions: [] }],
  ["Remote, Canada or US", ["Remote (Canada, US)"], undefined, { countries: ["CA", "US"], remote: "remote", remoteRegions: ["CA", "US"] }],
  ["Montréal accent", ["Montréal, QC"], undefined, { countries: ["CA"], remote: "unknown", remoteRegions: [] }],
  ["Washington DC / Seattle WA", ["Seattle, WA"], undefined, { countries: ["US"], remote: "unknown", remoteRegions: [] }],
];

describe("parseLocations", () => {
  test.each(cases)("%s", (_name, input, hint, expected) => {
    expect(parseLocations(input, hint)).toEqual(expected);
  });
  test("a remote role limited to an unrecognised region is not 'region unspecified'", () => {
    expect(parseLocations(["Remote - APAC"])).toEqual({ countries: ["OTHER"], remote: "remote", remoteRegions: ["OTHER"] });
  });
  test("an unrecognised place is OTHER", () => {
    expect(parseLocations(["Singapore"]).countries).toEqual(["OTHER"]);
  });
});


describe("parseCities", () => {
  test.each([
    [["Toronto, ON"], ["Toronto"]],
    [["Montréal, QC"], ["Montreal"]],
    [["Vancouver, BC, Canada", "New York, NY"], ["Vancouver", "New York"]],
    [["Remote in Canada"], []],
    [["Remote"], []],
    [["Canada"], []],
    [["Greater Vancouver, British Columbia (Remote)"], ["Vancouver"]],
    [["Hybrid - Waterloo"], ["Waterloo"]],
    [["San Francisco, CA"], ["San Francisco"]],
    [["Oakville, ON"], ["Oakville"]],
    [["Tel Aviv, Israel +1"], ["Tel Aviv"]],
    [["Toronto, ON", "Toronto, Ontario, Canada"], ["Toronto"]],
    [["Greater Montreal Metropolitan Area (Hybrid)"], ["Montreal"]],
    [["Ontario"], []],
  ] as [string[], string[]][])("%j -> %j", (input, expected) => expect(parseCities(input)).toEqual(expected));
});

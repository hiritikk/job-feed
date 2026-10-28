import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterRail } from "./FilterRail";
import { JobDrawer } from "./JobDrawer";
import { JobRow } from "./JobRow";
import { SourcePanel } from "./SourcePanel";
import { defaultFilters } from "../lib/filters";
import { NOW, hoursAgo, makeJob } from "../lib/testJob";

const noop = () => {};
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("JobRow", () => {
  test("shows company, title, one date line and an Apply link that opens safely", () => {
    const out = html(<JobRow job={makeJob({ company: "Shopify", title: "Software Engineer I", postedAt: hoursAgo(3) })} now={NOW} isNew={false} onOpen={noop} />);
    expect(out).toContain("Shopify");
    expect(out).toContain("Software Engineer I");
    expect(out).toContain("3h ago");
    expect(out).toMatch(/<a [^>]*href="https:\/\/stripe\.com\/jobs\/1"[^>]*rel="noopener noreferrer"/);
    expect(out).toContain('target="_blank"');
  });
  test("keeps the row quiet: no found-time, no precision bars, no role tag, no trust text for a normal job", () => {
    const out = html(<JobRow job={makeJob({ linkStatus: "ok" })} now={NOW} isNew={false} onOpen={noop} />);
    expect(out).not.toContain("found");
    expect(out).not.toContain("precision");
    expect(out).not.toContain("verified");
    expect(out).not.toContain(">Software<");
  });
  test("the Apply link uses the resolved destination when a shortlink was resolved", () => {
    const out = html(<JobRow job={makeJob({ url: "https://go.vansh.nyc/B2", resolvedUrl: "https://boards.greenhouse.io/databricks/jobs/1" })} now={NOW} isNew={false} onOpen={noop} />);
    expect(out).toContain('href="https://boards.greenhouse.io/databricks/jobs/1"');
    expect(out).not.toContain("go.vansh.nyc");
  });
  test("a date-only job shows the date; an estimated one shows ~; an undated one shows when it was found", () => {
    expect(html(<JobRow job={makeJob({ postedPrecision: "day", postedAt: "2026-10-22T00:00:00.000Z" })} now={NOW} isNew={false} onOpen={noop} />)).toContain("Oct 22");
    expect(html(<JobRow job={makeJob({ postedPrecision: "approx", postedApprox: true, postedAt: hoursAgo(24 * 7) })} now={NOW} isNew={false} onOpen={noop} />)).toContain("~7d ago");
    const undated = html(<JobRow job={makeJob({ postedPrecision: "none", postedApprox: true, firstSeenAt: hoursAgo(2) })} now={NOW} isNew={false} onOpen={noop} />);
    expect(undated).toContain("found 2h ago");
    expect(undated).not.toContain("date unknown");
  });
  test("flags only what matters: new, remote, class year and work-authorization limits", () => {
    const out = html(<JobRow job={makeJob({ gradYear: 2027, remote: "remote", remoteRegions: ["CA"], cities: ["Toronto", "Vancouver"], workAuth: "restricted" })} now={NOW} isNew={true} onOpen={noop} />);
    expect(out).toContain("New");
    expect(out).toContain("New grad 2027");
    expect(out).toContain("Remote in Canada");
    expect(out).toContain("Toronto, Vancouver");
    expect(out).toContain("Work authorization limits");
  });
  test("a broken link is flagged on the row", () => {
    expect(html(<JobRow job={makeJob({ linkStatus: "dead" })} now={NOW} isNew={false} onOpen={noop} />)).toContain("link broken");
  });
});

describe("JobDrawer", () => {
  test("shows link verification in the drawer, where the detail belongs", () => {
    expect(html(<JobDrawer job={makeJob({ linkStatus: "ok", linkCheckedAt: hoursAgo(1) })} now={NOW} onClose={noop} />)).toContain("verified");
    expect(html(<JobDrawer job={makeJob({ source: "jobright", linkStatus: "unknown" })} now={NOW} onClose={noop} />)).toContain("unverified");
  });
  test("explains date precision and shows an exact found time and link destination", () => {
    const out = html(<JobDrawer job={makeJob({ url: "https://www.amazon.jobs/en/jobs/1", linkStatus: "ok", linkCheckedAt: hoursAgo(1), sources: ["amazon", "simplify"] })} now={NOW} onClose={noop} />);
    expect(out).toContain("Exact posting time from the source");
    expect(out).toContain("Apply on amazon.jobs");
    expect(out).toContain("always exact");
    expect(out).toContain("amazon, simplify");
    expect(out).toContain('role="dialog"');
  });
});

describe("FilterRail", () => {
  const jobs = [makeJob(), makeJob({ cities: ["Vancouver"], locations: ["Vancouver, BC"] }), makeJob({ countries: ["US"], cities: ["Seattle"] })];
  const render = (over = {}) => html(<FilterRail jobs={jobs} filters={{ ...defaultFilters(), ...over }} setFilters={noop} sources={["greenhouse", "simplify"]} open={false} onClose={noop} matchCount={2} />);

  test("offers city chips for the selected countries only, with counts", () => {
    const out = render();
    expect(out).toContain("Toronto");
    expect(out).toContain("Vancouver");
    expect(out).not.toContain("Seattle"); // US is not selected
  });
  test("selecting the US adds its cities", () => {
    expect(render({ locations: ["CA", "US"] })).toContain("Seattle");
  });
  test("default chips are pressed for Canada and Remote and not for United States", () => {
    const out = render();
    expect(out).toMatch(/aria-pressed="true"[^>]*>Canada/);
    expect(out).toMatch(/aria-pressed="false"[^>]*>United States/);
  });
  test("includes prefilled link-outs for the boards we cannot read", () => {
    const out = render({ q: "ml" });
    expect(out).toContain("linkedin.com/jobs/search");
    expect(out).toContain("Job Bank");
  });
});

describe("SourcePanel", () => {
  test("summarises healthy sources and lists problems in plain language", () => {
    const out = html(<SourcePanel now={NOW} sources={[
      { source: "greenhouse", status: "ok", lastSuccessAt: hoursAgo(0.1), jobCount: 100 },
      { source: "microsoft", status: "stale", lastSuccessAt: hoursAgo(5), jobCount: 18, error: "HTTP 429" },
    ]} />);
    expect(out).toContain("1 of 2 sources up to date");
    expect(out).toContain("1 need attention");
    expect(out).toContain("Showing earlier data");
    expect(out).toContain("5 h ago");
  });
});

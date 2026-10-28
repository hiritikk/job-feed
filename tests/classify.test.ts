import { describe, test, expect } from "vitest";
import {
  classify, classifyGradYear, classifyLevel, classifyRoleType, classifyWorkAuth, classifyYearsRequired, isInternship, isSenior,
} from "../pipeline/classify.js";
import type { RawJob } from "../pipeline/types.js";

describe("classifyRoleType", () => {
  test.each([
    ["Software Development Engineer I", "sde"],
    ["Machine Learning Engineer, New Grad", "ml-ai"],
    ["Applied Scientist", "ml-ai"],
    ["Backend Engineer", "backend"],
    ["Full Stack Developer", "fullstack"],
    ["Site Reliability Engineer", "infra"],
    ["Data Engineer", "data"],
    ["Frontend Engineer", "sde"],
    ["Member of Technical Staff, Inference", "sde"],
    ["Security Engineer, New Grad", "sde"],
    ["QA Engineer", "sde"],
    ["Embedded Firmware Engineer", "sde"],
    ["Mechanical Engineer", "other"],
    ["Product Designer", "other"],
    ["Account Executive", "other"],
  ])("%s -> %s", (title, expected) => expect(classifyRoleType(title)).toBe(expected));
});

describe("classifyLevel", () => {
  test.each([
    ["University Grad 2027 - Software Engineer", "new-grad"],
    ["SDE 1", "new-grad"],
    ["Associate Software Engineer", "new-grad"],
    ["Software Engineer I", "new-grad"],
    ["Software Engineer, New Grad", "new-grad"],
    ["Software Engineer Graduate (Ads Infra) - 2027 Start", "new-grad"],
    ["Software Engineer, 2027 Graduate U.S.", "new-grad"],
    ["Backend Development Engineer Graduate (Infrastructure Platform Delivery) - 2027 Start", "new-grad"],
    ["Graduate Software Engineer - 2027 start", "new-grad"],
    ["Graduate Student Researcher, Distributed Systems", "other"],
    ["Senior Software Engineer, Graduate Programs", "other"],
    ["Junior Backend Developer", "early-career"],
    ["Software Engineer II", "early-career"],
    ["Senior Software Engineer", "other"],
    ["Staff Engineer, New Grad Programs Lead", "other"],
    ["Software Engineer III", "other"],
    ["Software Engineer", "other"],
  ])("%s -> %s", (title, expected) => expect(classifyLevel(title)).toBe(expected));
  test("description stating 0-2 years makes a plain title early-career", () => {
    expect(classifyLevel("Software Engineer", "We want 0-2 years of experience")).toBe("early-career");
  });
});

describe("classifyGradYear", () => {
  test.each([
    ["New Grad 2027", 2027],
    ["University Grad 2027 - Software Engineer", 2027],
    ["2026 New College Grad", 2026],
    ["Software Engineer, New Grad", null],
    ["Software Engineer 2027 Roadmap Lead", null],
  ])("%s -> %s", (title, expected) => expect(classifyGradYear(title)).toBe(expected));
  test("description 'class of 2027' is used when the title has no year", () => {
    expect(classifyGradYear("Software Engineer, New Grad", "Open to the class of 2027")).toBe(2027);
  });
});

describe("classifyWorkAuth", () => {
  test.each([
    ["Applicants must be a US citizen.", undefined, "restricted"],
    ["Active security clearance required", undefined, "restricted"],
    ["We do not sponsor visas", undefined, "no-sponsorship"],
    ["Visa sponsorship is not available for this role", undefined, "no-sponsorship"],
    ["No sponsorship. Applicants must be a US citizen.", undefined, "restricted"],
    ["We sponsor visas for eligible candidates", undefined, "sponsors"],
    ["Great team", "Does Not Offer Sponsorship", "no-sponsorship"],
    ["Great team", "U.S. Citizenship is Required", "restricted"],
    ["Great team", "Offers Sponsorship", "sponsors"],
    ["Great team", "Other", "unknown"],
    ["Great team", undefined, "unknown"],
    ["We do not provide free lunch or offer remote work", undefined, "unknown"],
    ["We cannot offer visa sponsorship at this time", undefined, "no-sponsorship"],
  ])("%s / %s -> %s", (text, hint, expected) => expect(classifyWorkAuth(text, hint)).toBe(expected));
});

describe("classifyYearsRequired", () => {
  test.each([
    ["5+ years of experience in backend development", 5],
    ["3-5 years of professional experience", 3],
    ["At least 4 years experience with distributed systems", 4],
    ["Minimum of 2 years of relevant experience", 2],
    ["1+ year of experience", 1],
    ["0-2 years of experience", 0],
    ["Bachelor's degree in CS. Strong problem solving.", null],
    ["We have been around for 10 years and ship weekly", null],
    ["5+ years of experience, or 2 years with a PhD", 2],
    ["", null],
  ])("%s -> %s", (text, expected) => expect(classifyYearsRequired(text)).toBe(expected));
});

describe("isSenior", () => {
  test.each([
    ["Senior Software Engineer", true], ["Sr. Backend Developer", true], ["Staff Engineer", true], ["Principal Engineer", true],
    ["Engineering Manager", true], ["Tech Lead, Payments", true], ["Director of Engineering", true], ["Head of Platform", true],
    ["Software Engineer", false], ["Software Engineer II", false], ["New Grad Software Engineer", false], ["Associate Software Engineer", false],
    ["Leader Programs Associate", false],
  ])("%s -> %s", (title, expected) => expect(isSenior(title)).toBe(expected));
});

describe("isInternship", () => {
  test.each([
    ["Software Engineer Intern, Summer 2027", true],
    ["SWE Co-op 2027", true],
    ["Engineering Internship", true],
    ["Software Engineering Apprenticeship", true],
    ["Internationalization Engineer", false],
    ["Internal Tools Engineer", false],
    ["Software Engineer, New Grad", false],
  ])("%s -> %s", (title, expected) => expect(isInternship(title)).toBe(expected));
});

describe("classify", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const raw: RawJob = {
    source: "greenhouse", sourceId: "1", company: "Stripe", title: "Software Engineer, New Grad 2027",
    url: "https://stripe.com/jobs/1?utm_source=x", locations: ["Toronto, ON"], postedAt: "2026-10-20T00:00:00Z",
    descriptionHtml: "<p>Build things. <b>Great</b> team.</p>",
  };
  test("builds a full Job", () => {
    const job = classify(raw, () => 1, now)!;
    expect(job).toMatchObject({
      company: "Stripe", source: "greenhouse", sources: ["greenhouse"], tier: 1, level: "new-grad", gradYear: 2027,
      roleType: "sde", countries: ["CA"], postedAt: "2026-10-20T00:00:00.000Z", postedApprox: false,
      firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString(), closedAt: null,
      snippet: "Build things. Great team.", workAuth: "unknown", url: "https://stripe.com/jobs/1", resolvedUrl: null,
    });
    expect(job.id).toHaveLength(40);
  });
  test("returns null for internships", () => {
    expect(classify({ ...raw, title: "Software Engineer Intern, Summer 2027" }, () => 1, now)).toBeNull();
    expect(classify({ ...raw, title: "SWE Co-op 2027" }, () => 1, now)).toBeNull();
  });
  test("missing postedAt falls back to now and is approximate", () => {
    const job = classify({ ...raw, postedAt: null }, () => 3, now)!;
    expect(job.postedAt).toBe(now.toISOString());
    expect(job.postedApprox).toBe(true);
    expect(job.tier).toBe(3);
  });
  test("records the years of experience the posting asks for", () => {
    expect(classify({ ...raw, descriptionHtml: "<p>You have 4+ years of experience.</p>" }, () => 1, now)!.yearsRequired).toBe(4);
    expect(classify({ ...raw, descriptionHtml: "<p>Great team.</p>" }, () => 1, now)!.yearsRequired).toBeNull();
  });
  test("sets cities, precision and link fields", () => {
    const job = classify(raw, () => 1, now)!;
    expect(job.cities).toEqual(["Toronto"]);
    expect(job.postedPrecision).toBe("exact");
    expect(job.linkStatus).toBe("unknown");
    expect(job.linkCheckedAt).toBeNull();
  });
  test("an explicit postedPrecision from the adapter is kept; approx and none set postedApprox", () => {
    expect(classify({ ...raw, postedPrecision: "day" }, () => 1, now)!).toMatchObject({ postedPrecision: "day", postedApprox: false });
    expect(classify({ ...raw, postedPrecision: "approx" }, () => 1, now)!).toMatchObject({ postedPrecision: "approx", postedApprox: true });
    expect(classify({ ...raw, postedAt: null }, () => 1, now)!).toMatchObject({ postedPrecision: "none", postedApprox: true });
  });
  test("legacy postedApprox=true maps to precision approx", () => {
    expect(classify({ ...raw, postedApprox: true }, () => 1, now)!.postedPrecision).toBe("approx");
  });
  test("relative or non-https urls are rejected", () => {
    expect(classify({ ...raw, url: "/jobs/1" }, () => 1, now)).toBeNull();
    expect(classify({ ...raw, url: "javascript:alert(1)" }, () => 1, now)).toBeNull();
    expect(classify({ ...raw, url: "" }, () => 1, now)).toBeNull();
  });
  test("tracking parameters are stripped but meaningful ones (gh_jid) are kept", () => {
    expect(classify({ ...raw, url: "https://jobright.ai/jobs/info/1?utm_campaign=Software%20Engineering&utm_source=1103" }, () => 1, now)!.url)
      .toBe("https://jobright.ai/jobs/info/1");
    expect(classify({ ...raw, url: "https://stripe.com/jobs/search?gh_jid=8172487&utm_medium=x" }, () => 1, now)!.url)
      .toBe("https://stripe.com/jobs/search?gh_jid=8172487");
  });
  test("http urls are upgraded to https", () => {
    expect(classify({ ...raw, url: "http://stripe.com/jobs/1" }, () => 1, now)!.url).toBe("https://stripe.com/jobs/1");
  });
  test("an unparseable postedAt falls back to now", () => {
    expect(classify({ ...raw, postedAt: "garbage" }, () => 3, now)!.postedAt).toBe(now.toISOString());
  });
});

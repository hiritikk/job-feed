import { describe, test, expect, vi } from "vitest";
import { createJev, JEV_ENDPOINT, JEV_MODEL, type Answers, type Jev } from "../pipeline/jev.js";
import { buildFitState, fitQuestions, judgesSkills, loadProfile, rateJobs, ratingTargets, scoreFit, type Profile } from "../pipeline/fit.js";
import type { Http, Job } from "../pipeline/types.js";

const NOW = new Date("2026-11-16T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const profile: Profile = { summary: "CS student, two internships.", skills: ["TypeScript", "Python"], graduation: "April 2027", citizenships: ["CA"], authorizedCountries: ["CA"] };

let seq = 0;
const job = (over: Partial<Job> = {}): Job => ({
  id: `j${++seq}`, company: "Acme", title: "Software Engineer", url: `https://acme.example/jobs/${seq}`, locations: ["Toronto, ON"], countries: ["CA"], cities: ["Toronto"],
  remote: "unknown", remoteRegions: [], postedAt: daysAgo(1), postedApprox: false, postedPrecision: "exact", firstSeenAt: daysAgo(1), lastSeenAt: daysAgo(0), closedAt: null,
  linkStatus: "unknown", linkCheckedAt: null, resolvedUrl: null, source: "greenhouse", sources: ["greenhouse"], roleType: "sde", level: "other", gradYear: null, workAuth: "unknown", tier: 3, snippet: "short", ...over,
});

const answers = (over: Partial<Record<string, unknown>> = {}): Answers => ({
  is_software_role: { type: "noul", noul: 0.98 },
  level: { type: "choice", choice: "new_grad", confidence: 0.9 },
  needs_advanced_degree: { type: "noul", noul: 0.02 },
  graduation_excluded: { type: "noul", noul: 0.05 },
  work_auth: { type: "choice", choice: "canada_ok", confidence: 0.8 },
  stack_match: { type: "score", score: 3, confidence: 0.7 },
  experience_match: { type: "score", score: 3, confidence: 0.7 },
  callback_likelihood: { type: "score", score: 3, confidence: 0.7 },
  ...over,
} as Answers);

describe("createJev", () => {
  const httpReturning = (body: unknown) => {
    const json = vi.fn(async () => body as never);
    return { http: { json, text: async () => "" } as Http, json };
  };

  test("posts the state and questions to OpenRouter with the key, and returns the answers", async () => {
    const { http, json } = httpReturning({ answers: answers(), usage: { input_tokens: 700, cost: 0.00003 } });
    const jev = createJev(http, "sk-test");
    const out = await jev.decide({ job: { title: "x" } }, fitQuestions(profile));
    expect(out.level).toMatchObject({ choice: "new_grad" });
    const [url, init] = json.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(JEV_ENDPOINT);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    expect(JSON.parse(String(init.body))).toMatchObject({ model: JEV_MODEL, state: { job: { title: "x" } }, questions: { level: { type: "choice" } } });
    expect(jev.usage).toEqual({ calls: 1, costUsd: 0.00003 });
  });

  test("works the cost out from input tokens when the response carries none", async () => {
    const jev = createJev(httpReturning({ answers: answers(), usage: { input_tokens: 1_000_000 } }).http, "k");
    await jev.decide({}, fitQuestions(profile));
    expect(jev.usage.costUsd).toBeCloseTo(0.042);
  });

  test("rejects a response that leaves a question unanswered or answers it with the wrong type", async () => {
    const { level: _level, ...missing } = answers();
    await expect(createJev(httpReturning({ answers: missing }).http, "k").decide({}, fitQuestions(profile))).rejects.toThrow(/level/);
    const wrong = answers({ level: { type: "noul", noul: 1 } });
    await expect(createJev(httpReturning({ answers: wrong }).http, "k").decide({}, fitQuestions(profile))).rejects.toThrow(/expected choice/);
  });

  test("refuses further calls once the spend cap is reached", async () => {
    const jev = createJev(httpReturning({ answers: answers(), usage: { cost: 0.3 } }).http, "k", { spendCapUsd: 0.25 });
    await jev.decide({}, fitQuestions(profile));
    await expect(jev.decide({}, fitQuestions(profile))).rejects.toThrow(/spend cap/);
  });
});

describe("loadProfile", () => {
  const basics = { skills: [], graduation: "April 2027", citizenships: [], authorizedCountries: ["CA"] };
  test("without the secret, uses the public basics in config/fit.yml (eligibility only)", () => {
    expect(loadProfile({})).toEqual(basics);
    expect(judgesSkills(loadProfile({}))).toBe(false);
  });
  test("the secret, when valid, replaces the basics and turns on the skills match", () => {
    expect(loadProfile({ FIT_PROFILE: JSON.stringify(profile) })).toEqual(profile);
    expect(judgesSkills(profile)).toBe(true);
  });
  test("a malformed secret falls back to the basics and names the bad field without printing the profile", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadProfile({ FIT_PROFILE: JSON.stringify({ ...profile, authorizedCountries: [], summary: "secret words" }) })).toEqual(basics);
    expect(loadProfile({ FIT_PROFILE: "{not json" })).toEqual(basics);
    expect(warn.mock.calls[0][0]).toContain("authorizedCountries");
    expect(warn.mock.calls.flat().join(" ")).not.toContain("secret words");
    warn.mockRestore();
  });
  test("the committed example profile is valid and judges skills", async () => {
    const { readFileSync } = await import("node:fs");
    expect(judgesSkills(loadProfile({ FIT_PROFILE: readFileSync("config/profile.example.json", "utf8") }))).toBe(true);
  });
});

const basicsOnly: Profile = { skills: [], graduation: "May 2027", citizenships: [], authorizedCountries: ["CA"] };
const eligibilityAnswers = (over: Partial<Record<string, unknown>> = {}): Answers => {
  const { stack_match: _s, experience_match: _e, callback_likelihood: _c, ...rest } = answers(over);
  return rest;
};

describe("fit state and questions", () => {
  test("the graduation questions are worded for the profile's own date", () => {
    expect(fitQuestions(basicsOnly).graduation_excluded.instructions).toContain("May 2027");
  });
  test("without a skills profile only eligibility is asked, and nothing about the candidate's skills is sent", () => {
    expect(Object.keys(fitQuestions(basicsOnly))).toEqual(["is_software_role", "level", "needs_advanced_degree", "graduation_excluded", "work_auth"]);
    expect(Object.keys(fitQuestions(profile))).toContain("stack_match");
    expect(buildFitState(job(), "text", basicsOnly).candidate).toEqual({ graduation: "May 2027", citizenship: [], authorized_to_work_in: ["CA"] });
  });
  test("the state carries the full text, capped, and falls back to the snippet, then to a note", () => {
    expect((buildFitState(job(), "x".repeat(9000), profile).job as { description: string }).description).toHaveLength(6000);
    expect((buildFitState(job({ snippet: "short" }), "", profile).job as { description: string }).description).toBe("short");
    expect((buildFitState(job({ snippet: "" }), "", profile).job as { description: string }).description).toContain("no description");
  });
});

describe("scoreFit", () => {
  test("strong answers across the board score 0.78 with no skip", () => {
    expect(scoreFit(answers(), profile)).toEqual({ score: 0.78, skip: null, reasons: ["stack match: strong", "new-grad level", "no work-authorization barrier stated"] });
  });
  test("eligibility only: a clear new-grad role scores high, an unclear level stays under the alert threshold", () => {
    expect(scoreFit(eligibilityAnswers(), basicsOnly)).toEqual({ score: 0.95, skip: null, reasons: ["new-grad level", "no work-authorization barrier stated"] });
    expect(scoreFit(eligibilityAnswers({ level: { type: "choice", choice: "new_grad", confidence: 0.4 } }), basicsOnly).score).toBe(0.7);
    expect(scoreFit(eligibilityAnswers({ level: { type: "choice", choice: "other", confidence: 0.9 } }), basicsOnly).score).toBe(0.4);
  });
  test("eligibility only: a graduation window that excludes May 2027 drops a clear new-grad role under the threshold", () => {
    expect(scoreFit(eligibilityAnswers({ graduation_excluded: { type: "noul", noul: 0.95 } }), basicsOnly).score).toBe(0.57);
  });
  test("a posting that asks for experience is skipped only when JEV is confident", () => {
    expect(scoreFit(answers({ level: { type: "choice", choice: "experienced", confidence: 0.9 } }), profile).skip).toBe("asks for professional experience");
    expect(scoreFit(answers({ level: { type: "choice", choice: "experienced", confidence: 0.4 } }), profile).skip).toBeNull();
  });
  test("non-software roles, internships and required advanced degrees are skipped", () => {
    expect(scoreFit(answers({ is_software_role: { type: "noul", noul: 0.1 } }), profile).skip).toBe("not a software role");
    expect(scoreFit(answers({ level: { type: "choice", choice: "internship", confidence: 0.9 } }), profile).skip).toBe("internship");
    expect(scoreFit(answers({ needs_advanced_degree: { type: "noul", noul: 0.9 } }), profile).skip).toBe("advanced degree required");
  });
  test("US work-authorization limits skip only a candidate they apply to", () => {
    const noSponsor = answers({ work_auth: { type: "choice", choice: "us_no_sponsorship", confidence: 0.8 } });
    const citizen = answers({ work_auth: { type: "choice", choice: "us_citizenship_required", confidence: 0.8 } });
    expect(scoreFit(noSponsor, profile).skip).toBe("US role, no sponsorship");
    expect(scoreFit(noSponsor, { citizenships: ["CA"], authorizedCountries: ["CA", "us"] }).skip).toBeNull();
    expect(scoreFit(citizen, profile).skip).toBe("US citizenship or clearance required");
    expect(scoreFit(citizen, { citizenships: ["US"], authorizedCountries: ["US"] }).skip).toBeNull();
  });
  test("a graduation window that excludes the candidate lowers the score and says so, without skipping", () => {
    const fit = scoreFit(answers({ graduation_excluded: { type: "noul", noul: 0.95 } }), profile);
    expect(fit).toMatchObject({ score: 0.47, skip: null });
    expect(fit.reasons).toContain("asks for a different graduation date");
  });
});

describe("ratingTargets and rateJobs", () => {
  const fakeJev = (decide: Jev["decide"]): Jev => ({ decide, usage: { calls: 0, costUsd: 0 } });
  const textsFor = (jobs: Job[]) => new Map(jobs.map((j) => [j.url, "full text"]));

  test("targets are open, unrated, recent postings fetched this run, newest first, capped", () => {
    const fresh = job({ firstSeenAt: daysAgo(0) }), older = job({ firstSeenAt: daysAgo(3) });
    const all = [older, fresh, job({ fit: { score: 0.5, skip: null, reasons: [] } }), job({ closedAt: daysAgo(0) }), job({ linkStatus: "dead" }), job({ firstSeenAt: daysAgo(20) })];
    const notFetched = job();
    const texts = textsFor(all);
    expect(ratingTargets([...all, notFetched], texts, NOW).map((j) => j.id)).toEqual([fresh.id, older.id]);
    expect(ratingTargets(all, texts, NOW, 1).map((j) => j.id)).toEqual([fresh.id]);
  });

  test("rates each target in place with the posting's full text", async () => {
    const jobs = [job(), job()];
    const decide = vi.fn(async () => answers());
    expect(await rateJobs(jobs, textsFor(jobs), fakeJev(decide), profile, NOW)).toEqual({ rated: 2, failed: 0 });
    expect(jobs.every((j) => j.fit?.score === 0.78)).toBe(true);
    expect((decide.mock.calls[0] as unknown as [{ job: { description: string } }])[0].job.description).toBe("full text");
  });

  test("one failed call leaves that posting unrated and the rest rated", async () => {
    const jobs = [job({ firstSeenAt: daysAgo(0) }), job({ firstSeenAt: daysAgo(1) }), job({ firstSeenAt: daysAgo(2) })];
    let n = 0;
    const res = await rateJobs(jobs, textsFor(jobs), fakeJev(async () => { if (++n === 2) throw new Error("HTTP 500"); return answers(); }), profile, NOW, { concurrency: 1 });
    expect(res).toEqual({ rated: 2, failed: 1 });
    expect(jobs.map((j) => Boolean(j.fit))).toEqual([true, false, true]);
  });

  test("gives up after five failures in a row instead of failing every posting, and never throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const jobs = Array.from({ length: 20 }, () => job());
    const decide = vi.fn(async (): Promise<Answers> => { throw new Error("HTTP 401"); });
    expect(await rateJobs(jobs, textsFor(jobs), fakeJev(decide), profile, NOW, { concurrency: 1 })).toEqual({ rated: 0, failed: 5 });
    expect(decide).toHaveBeenCalledTimes(5);
    warn.mockRestore();
  });
});

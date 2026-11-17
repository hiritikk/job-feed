import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { JevSpendCapError, type Answers, type Jev, type Questions } from "./jev.js";
import type { Fit, Job } from "./types.js";

/**
 * The fit rating: one JEV call per posting asks what the keyword rules can only guess at (real level, graduation
 * window, work authorization, how well the stack matches), and code turns the answers into a score and short reasons.
 * Adapted from qbeka/jev-job-search (MIT), src/jobs/rate.ts.
 *
 * Two depths. With only config/fit.yml (graduation date and where you can work), JEV checks whether you can apply.
 * With the private FIT_PROFILE secret (summary and skills too), it also judges how well the posting matches you.
 * The score and reasons are published in jobs.json, so reasons describe the posting and never quote the profile.
 */
const profileSchema = z.object({
  /** Two or three sentences: degree, experience, what you have built. With `skills`, turns on the skills match. */
  summary: z.string().min(1).optional(),
  skills: z.array(z.string().min(1)).default([]),
  /** Month and year, e.g. "April 2027". */
  graduation: z.string().min(1),
  /** Country codes, e.g. ["CA"]. */
  citizenships: z.array(z.string()).default([]),
  /** Countries you can work in without sponsorship, e.g. ["CA"]. */
  authorizedCountries: z.array(z.string()).min(1),
});
export type Profile = z.infer<typeof profileSchema>;

/** Whether the profile says enough about the candidate to judge skills, not just eligibility. */
export const judgesSkills = (profile: Profile): boolean => Boolean(profile.summary) && profile.skills.length > 0;

/**
 * The FIT_PROFILE secret (JSON) when it is set and valid, otherwise the public basics in config/fit.yml. The secret's
 * content is never logged; a malformed one is reported by field name and the basics are used instead.
 */
export function loadProfile(env: Record<string, string | undefined>, path = "config/fit.yml"): Profile {
  const basics = profileSchema.parse(parse(readFileSync(path, "utf8")));
  const text = env.FIT_PROFILE?.trim();
  if (!text) return basics;
  try {
    return profileSchema.parse(JSON.parse(text));
  } catch (err) {
    const fields = err instanceof z.ZodError ? err.issues.map((i) => i.path.join(".") || "(root)").join(", ") : "not valid JSON";
    console.warn(`FIT_PROFILE is set but unusable (${fields}): rating eligibility only, from ${path}`);
    return basics;
  }
}

const MATCH = ["None", "Weak", "Partial", "Strong", "Near exact"];
const CALLBACK = ["Very unlikely", "Unlikely", "Possible", "Likely", "Very likely"];

export function fitQuestions(profile: Profile): Questions {
  const grad = profile.graduation;
  const eligibility: Questions = {
    is_software_role: {
      type: "noul",
      instructions: "Is this a software, machine learning, data or infrastructure engineering role where the day-to-day work is writing code?",
      criteria: { true: "The day-to-day work is writing software, models, data pipelines or infrastructure code", false: "Hardware, analytics without code, product, design, sales, IT support, or anything else" },
    },
    level: {
      type: "choice",
      instructions: "What level is this posting?",
      criteria: {
        internship: "Internship, co-op, student or work term",
        new_grad: "New grad, early career, entry level, or junior with 0 to 2 years of experience",
        experienced: "Requires 3 or more years of professional experience, or is mid, senior, staff or lead",
        other: "Unclear or not a job posting",
      },
    },
    needs_advanced_degree: { type: "noul", instructions: "Does the posting require (not merely prefer) a Master's degree or PhD?" },
    graduation_excluded: {
      type: "noul",
      instructions: `Does the posting require a graduation date or class year that a candidate graduating in ${grad} does not meet?`,
      criteria: { true: `It names a graduation window or class year that excludes ${grad}`, false: `No graduation requirement is stated, or ${grad} fits it` },
    },
    work_auth: {
      type: "choice",
      instructions: "What does the posting require for work authorization?",
      criteria: {
        canada_ok: "Canadian work authorization is enough, or the role is in Canada with no restriction stated",
        us_sponsors: "The role is in the United States and the posting says sponsorship is available or possible",
        us_no_sponsorship: "The role is in the United States and the posting says no sponsorship, or must be authorized without sponsorship",
        us_citizenship_required: "US citizenship, a security clearance, or ITAR eligibility is required",
        remote_global: "Remote and open to candidates in any country",
        unclear: "Not stated and not inferable",
      },
    },
  };
  if (!judgesSkills(profile)) return eligibility;
  return {
    ...eligibility,
    stack_match: { type: "score", instructions: "How well does the candidate's technical stack match what the posting asks for?", criteria: MATCH },
    experience_match: { type: "score", instructions: "How well does the candidate's experience level and background match what the posting asks for?", criteria: MATCH },
    callback_likelihood: { type: "score", instructions: "Given everything, how likely is this candidate to be invited to interview if they apply?", criteria: CALLBACK },
  };
}

const DESCRIPTION_CHARS = 6000;

export function buildFitState(job: Job, description: string, profile: Profile): Record<string, unknown> {
  return {
    job: {
      company: job.company,
      title: job.title,
      locations: job.locations,
      description: description.slice(0, DESCRIPTION_CHARS) || job.snippet || "(no description available; judge from the title and company)",
    },
    candidate: {
      ...(judgesSkills(profile) ? { summary: profile.summary, skills: profile.skills } : {}),
      graduation: profile.graduation,
      citizenship: profile.citizenships,
      authorized_to_work_in: profile.authorizedCountries,
    },
  };
}

const WEIGHTS = { stack: 0.4, experience: 0.25, callback: 0.25, level: 0.1 };
const LEVEL_FIT: Record<string, number> = { new_grad: 1, other: 0.4, internship: 0.3, experienced: 0.1 };
const GRADUATION_MISMATCH = 0.6; // you may still apply, so a window that excludes you lowers the score instead of skipping

export function scoreFit(answers: Answers, profile: Pick<Profile, "citizenships" | "authorizedCountries">): Fit {
  const noul = (k: string): number => { const a = answers[k]; return a?.type === "noul" ? a.noul : 0; };
  const choice = (k: string): { choice: string; confidence: number } => { const a = answers[k]; return a?.type === "choice" ? a : { choice: "", confidence: 0 }; };
  const unit = (k: string, levels: number): number => { const a = answers[k]; return a?.type === "score" ? Math.min(1, Math.max(0, a.score / (levels - 1))) : 0; };
  const has = (list: string[], code: string): boolean => list.some((c) => c.toUpperCase() === code);

  const level = choice("level");
  const auth = choice("work_auth");
  const usAuthorized = has(profile.authorizedCountries, "US");
  const usCitizen = has(profile.citizenships, "US");

  let skip: string | null = null;
  if (noul("is_software_role") < 0.5) skip = "not a software role";
  else if (level.choice === "experienced" && level.confidence >= 0.6) skip = "asks for professional experience";
  else if (level.choice === "internship" && level.confidence >= 0.6) skip = "internship";
  else if (noul("needs_advanced_degree") > 0.7) skip = "advanced degree required";
  else if (auth.choice === "us_no_sponsorship" && auth.confidence >= 0.5 && !usAuthorized) skip = "US role, no sponsorship";
  else if (auth.choice === "us_citizenship_required" && auth.confidence >= 0.5 && !usCitizen) skip = "US citizenship or clearance required";

  const stack = unit("stack_match", MATCH.length);
  const gradExcluded = noul("graduation_excluded") > 0.7;
  const levelFit = LEVEL_FIT[level.choice] ?? 0.4;
  const skillsJudged = answers.stack_match !== undefined;
  // Without a skills profile the score is eligibility alone: how surely this is a new-grad role (0.5 to 1), or the level's own weight.
  const base = skillsJudged
    ? WEIGHTS.stack * stack + WEIGHTS.experience * unit("experience_match", MATCH.length) + WEIGHTS.callback * unit("callback_likelihood", CALLBACK.length) + WEIGHTS.level * levelFit
    : level.choice === "new_grad" ? 0.5 + 0.5 * level.confidence : levelFit;
  const score = Math.round(base * (gradExcluded ? GRADUATION_MISMATCH : 1) * 100) / 100;

  const reasons = skillsJudged ? [`stack match: ${MATCH[Math.round(stack * (MATCH.length - 1))].toLowerCase()}`] : [];
  if (level.choice === "new_grad") reasons.push("new-grad level");
  if (auth.choice === "canada_ok" || auth.choice === "remote_global") reasons.push("no work-authorization barrier stated");
  if (gradExcluded) reasons.push("asks for a different graduation date");
  if (auth.choice === "us_sponsors" && !usAuthorized) reasons.push("US role, sponsorship offered");
  return { score, skip, reasons, newGrad: level.choice === "new_grad" && !gradExcluded };
}

const DAY = 86_400_000;
const RATE_WINDOW_DAYS = 14; // older postings are not worth the catch-up
const MAX_RATINGS_PER_RUN = 400; // keeps a catch-up from stretching a run; a normal run rates a dozen
const FAILURES_BEFORE_GIVING_UP = 5;

/** Postings this run should rate: open, unrated, found within the window, and fetched this run (so we have their text). Newest first. */
export function ratingTargets(jobs: Job[], texts: Map<string, string>, now: Date, max = MAX_RATINGS_PER_RUN): Job[] {
  return jobs
    .filter((j) => !j.fit && !j.closedAt && j.linkStatus !== "dead" && texts.has(j.url) && now.getTime() - new Date(j.firstSeenAt).getTime() <= RATE_WINDOW_DAYS * DAY)
    .sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt) || a.tier - b.tier)
    .slice(0, max);
}

/** Whether a posting is too old for a rating; such postings need no text kept for them. */
export const pastRatingWindow = (job: Job, now: Date): boolean => now.getTime() - new Date(job.firstSeenAt).getTime() > RATE_WINDOW_DAYS * DAY;

/**
 * Rates the targets in place (sets `job.fit`). Never throws: a failed call leaves that posting unrated for the next
 * run, and repeated failures or the spend cap end the rating for this run.
 */
export async function rateJobs(jobs: Job[], texts: Map<string, string>, jev: Jev, profile: Profile, now: Date, opts: { max?: number; concurrency?: number } = {}): Promise<{ rated: number; failed: number }> {
  const targets = ratingTargets(jobs, texts, now, opts.max);
  const questions = fitQuestions(profile);
  let next = 0, rated = 0, failed = 0, streak = 0, stop: string | null = null;
  const worker = async (): Promise<void> => {
    while (next < targets.length && stop === null) {
      const job = targets[next++];
      try {
        job.fit = scoreFit(await jev.decide(buildFitState(job, texts.get(job.url) ?? "", profile), questions), profile);
        rated++;
        streak = 0;
      } catch (err) {
        failed++;
        if (err instanceof JevSpendCapError) stop = err.message;
        else if (++streak >= FAILURES_BEFORE_GIVING_UP) stop = `${streak} calls failed in a row (last: ${(err as Error).message})`;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, targets.length) }, worker));
  if (stop !== null) console.warn(`fit ratings stopped early: ${stop}`);
  return { rated, failed };
}

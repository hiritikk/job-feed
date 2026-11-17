import { z } from "zod";
import type { Http } from "./types.js";

/**
 * Client for JEV, TypeSafe's decision model, through OpenRouter's Decisions API
 * (https://openrouter.ai/docs/guides/community/jev). One call sends a state and a map of typed questions and gets a
 * typed answer with probabilities per question; the model never writes text.
 * Adapted from qbeka/jev-job-search (MIT), src/jev/client.ts.
 */
export type NoulQuestion = { type: "noul"; instructions: string; criteria?: { true: string; false: string } };
export type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };
/** Criteria are ordered lowest to highest; the answer is the probability-weighted index. */
export type ScoreQuestion = { type: "score"; instructions: string; criteria: string[] };
export type Questions = Record<string, NoulQuestion | ChoiceQuestion | ScoreQuestion>;

const noulAnswer = z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) });
const choiceAnswer = z.object({ type: z.literal("choice"), choice: z.string(), confidence: z.number().min(0).max(1) });
const scoreAnswer = z.object({ type: z.literal("score"), score: z.number(), confidence: z.number().min(0).max(1) });
const answer = z.discriminatedUnion("type", [noulAnswer, choiceAnswer, scoreAnswer]);
const response = z.object({
  answers: z.record(z.string(), answer),
  usage: z.object({ input_tokens: z.number().optional(), cost: z.number().optional() }).optional(),
});

export type Answer = z.infer<typeof answer>;
export type Answers = Record<string, Answer>;
export type JevUsage = { calls: number; costUsd: number };
export type Jev = { decide(state: Record<string, unknown>, questions: Questions): Promise<Answers>; readonly usage: JevUsage };

export const JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
export const JEV_MODEL = "typesafe/jev-1.13";
const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000; // list price; used only when a response carries no cost
const RUN_SPEND_CAP_USD = 0.25; // a guard against a bug, not a budget: a normal run costs well under a cent

export class JevSpendCapError extends Error {}

export function createJev(http: Http, apiKey: string, opts: { model?: string; spendCapUsd?: number } = {}): Jev {
  const usage: JevUsage = { calls: 0, costUsd: 0 };
  const cap = opts.spendCapUsd ?? RUN_SPEND_CAP_USD;
  return {
    usage,
    async decide(state, questions) {
      if (usage.costUsd >= cap) throw new JevSpendCapError(`JEV spend cap of $${cap} reached for this run`);
      const raw = await http.json(JEV_ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: opts.model ?? JEV_MODEL, state, questions }),
      });
      const parsed = response.parse(raw);
      usage.calls += 1;
      usage.costUsd += parsed.usage?.cost ?? (parsed.usage?.input_tokens ?? 0) * USD_PER_INPUT_TOKEN;
      for (const [key, q] of Object.entries(questions)) {
        const a = parsed.answers[key];
        if (!a) throw new Error(`JEV left "${key}" unanswered`);
        if (a.type !== q.type) throw new Error(`JEV answered "${key}" as ${a.type}, expected ${q.type}`);
      }
      return parsed.answers;
    },
  };
}

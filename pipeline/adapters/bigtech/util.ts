export type BigTechOptions = { delayMs?: number; queries?: string[]; locations?: string[]; maxPages?: number };

/** Polite pause between requests to the same careers site (spec §3.1b: >= 1 s). */
export const sleep = (ms: number): Promise<void> => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export const DEFAULT_QUERIES = ["software engineer", "new grad software", "university graduate"];
export const DEFAULT_LOCATIONS = ["Canada", "United States"];

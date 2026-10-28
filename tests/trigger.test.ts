import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A fake `gh`: `run list` prints the given createdAt, `workflow run` records that it was called. */
function fakeGh(createdAt: string | null): { gh: string; calls: () => string } {
  const dir = mkdtempSync(join(tmpdir(), "trigger-"));
  const log = join(dir, "calls.log");
  const gh = join(dir, "gh");
  writeFileSync(gh, `#!/usr/bin/env bash\necho "$@" >> "${log}"\nif [ "$1" = "run" ]; then ${createdAt ? `echo "${createdAt}"` : "true"}; fi\n`);
  chmodSync(gh, 0o755);
  writeFileSync(log, "");
  return { gh, calls: () => readFileSync(log, "utf8") };
}
const ago = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
const run = (gh: string): string => execFileSync("bash", ["scripts/trigger-refresh.sh"], { env: { ...process.env, GH: gh }, encoding: "utf8" });

describe("trigger-refresh.sh", () => {
  test("starts the workflow when the last run is older than 25 minutes", () => {
    const f = fakeGh(ago(40));
    expect(run(f.gh)).toContain("triggered");
    expect(f.calls()).toContain("workflow run refresh.yml");
  });
  test("does nothing when a run started recently, so it never doubles up with GitHub's own schedule", () => {
    const f = fakeGh(ago(10));
    expect(run(f.gh)).toContain("skipped");
    expect(f.calls()).not.toContain("workflow run");
  });
  test("starts the workflow when there has never been a run", () => {
    const f = fakeGh(null);
    expect(run(f.gh)).toContain("triggered");
    expect(f.calls()).toContain("workflow run refresh.yml");
  });
});

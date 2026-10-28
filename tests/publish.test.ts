import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function publish(dataDir: string, url: string): void {
  execFileSync("bash", ["scripts/publish-data.sh"], { env: { ...process.env, DATA_DIR: dataDir, PUBLISH_URL: url }, encoding: "utf8" });
}

describe("publish-data.sh", () => {
  test("force-pushes jobs.json and state.json as a single commit on the data branch, every time", () => {
    const remote = mkdtempSync(join(tmpdir(), "remote-"));
    git(remote, "init", "-q", "--bare", "-b", "data");
    const dataDir = mkdtempSync(join(tmpdir(), "data-"));
    writeFileSync(join(dataDir, "jobs.json"), '{"v":1}');
    writeFileSync(join(dataDir, "state.json"), '{"alerted":[]}');
    writeFileSync(join(dataDir, "scratch.tmp"), "must not be published");
    publish(dataDir, remote);
    writeFileSync(join(dataDir, "jobs.json"), '{"v":2}');
    publish(dataDir, remote);

    expect(git(remote, "rev-list", "--count", "data")).toBe("1");
    expect(git(remote, "show", "data:jobs.json")).toBe('{"v":2}');
    expect(git(remote, "ls-tree", "--name-only", "data").split("\n").sort()).toEqual(["jobs.json", "state.json"]);
  });

  test("fails loudly when jobs.json is missing, publishing nothing", () => {
    const remote = mkdtempSync(join(tmpdir(), "remote-"));
    git(remote, "init", "-q", "--bare", "-b", "data");
    const dataDir = mkdtempSync(join(tmpdir(), "data-"));
    expect(() => publish(dataDir, remote)).toThrow();
    expect(() => git(remote, "rev-parse", "data")).toThrow();
  });
});

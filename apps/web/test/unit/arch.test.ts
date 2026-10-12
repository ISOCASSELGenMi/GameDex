/**
 * Phase 1 完成標準：刻意違規的範例被 lint:arch 擋下。
 * 對 test/arch-fixtures 跑同一份 .dependency-cruiser.cjs，斷言每條規則都觸發。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const webDir = path.resolve(__dirname, "../..");
const fixtureDir = path.join(webDir, "test/arch-fixtures");
const config = path.join(webDir, ".dependency-cruiser.cjs");
// workspaces 會把套件提升到 repo 根目錄；往上找 node_modules
function findCli(dir: string): string {
  const candidate = path.join(dir, "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs");
  if (existsSync(candidate)) return candidate;
  const parent = path.dirname(dir);
  if (parent === dir) throw new Error("找不到 dependency-cruiser");
  return findCli(parent);
}
const cli = findCli(webDir);

function cruise(cwd: string) {
  const r = spawnSync(process.execPath, [cli, "src", "--config", config, "--output-type", "json"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const json = JSON.parse(r.stdout) as { summary: { violations: { rule: { name: string }; from: string }[] } };
  return json.summary.violations;
}

describe("lint:arch", () => {
  it("刻意違規的 fixture 全部被擋下", () => {
    const rules = new Set(cruise(fixtureDir).map((v) => v.rule.name));
    for (const expected of [
      "drizzle-only-in-repository",
      "db-client-only-in-repository",
      "presentation-no-provider-or-repo",
      "catalog-no-optional",
      "only-registry-and-app-import-optional",
      "kernel-no-modules",
      "no-deep-import",
      "domain-is-pure",
    ]) {
      expect(rules, `規則 ${expected} 應該被觸發`).toContain(expected);
    }
  }, 60_000);

  it("正式程式碼沒有違規", () => {
    expect(cruise(webDir)).toEqual([]);
  }, 60_000);
});

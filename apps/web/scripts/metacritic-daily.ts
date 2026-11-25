// 每日自動抓取 Metacritic（本機）：把當天的請求額度用到接近上限，順序＝先抓已確認配對的分數、重驗舊配對、新配對、（每週）更新索引。
// 由 Claude 啟動時的 hook 經 scripts/metacritic-daily-launch.mjs 在背景啟動；也可手動執行：
//   npx tsx --import ./scripts/load-env.ts scripts/metacritic-daily.ts
// 狀態：.local/metacritic-daily.json（當天已做完或進行中就不重跑）、紀錄：.local/metacritic-daily.log。
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { closeDb } from "@/kernel/db/client";
import { getSyncState } from "@/kernel/db/sync-state";
import { runJobOnce } from "@/kernel/scheduler";
import { enabledModules } from "@/modules/registry";
import { dailyRequestLimit, loadBudget } from "@/modules/metacritic/use-cases/runtime";
import { jobBudgetLimit, runFactsStep } from "./lib/review-facts";

const WEB = process.cwd();
const LOCAL = path.resolve(WEB, "../../.local");
const MARKER = path.join(LOCAL, "metacritic-daily.json");
const LOG = path.join(LOCAL, "metacritic-daily.log");
/** 離每日上限留的空間（給手動操作與重試）。 */
const MARGIN = 20;
/** 剩餘額度低於這個就收工（再跑一輪任務也做不了什麼）。 */
const MIN_USEFUL = 10;
const INDEX_REFRESH_DAYS = 7;
const MAX_RUNS = 24;
/** 一輪任務用掉的請求少於這個數，視為沒有新事可做。 */
const SMALL_RUN = 15;
/** 留給最後一步「補校驗頁需要的 Metacritic 頁面資料（發售日）」的請求數；前面的任務用不到這一段。 */
const FACTS_RESERVE = 60;
/** 最後一步最多補幾頁（只補校驗頁會顯示的：待校驗、已採用、手動確認）。 */
const FACTS_MAX = 120;

const today = () => new Date().toISOString().slice(0, 10);
const log = (msg: string) => {
  fs.mkdirSync(LOCAL, { recursive: true });
  fs.appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`);
};
const mark = (state: "running" | "done" | "failed", extra: Record<string, unknown> = {}) => {
  fs.mkdirSync(LOCAL, { recursive: true });
  const prev = fs.existsSync(MARKER) ? (JSON.parse(fs.readFileSync(MARKER, "utf8")) as Record<string, unknown>) : {};
  fs.writeFileSync(MARKER, JSON.stringify({ ...(prev.day === today() ? prev : {}), day: today(), state, updatedAt: new Date().toISOString(), ...extra }, null, 1));
};

function canConnect(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

/** 資料庫沒在跑就在背景啟動（分離的行程，不隨本腳本結束），最多等 120 秒。 */
async function ensureDb(): Promise<boolean> {
  const url = new URL(process.env.DATABASE_URL ?? "postgres://localhost:54329/x");
  const host = url.hostname === "localhost" ? "127.0.0.1" : url.hostname;
  const port = Number(url.port || 5432);
  if (await canConnect(host, port)) return true;
  if (!["127.0.0.1", "::1"].includes(host)) return false; // 遠端資料庫不代為啟動
  log("資料庫沒有回應，在背景啟動 db:start");
  const tsxCli = path.resolve(WEB, "../../node_modules/tsx/dist/cli.mjs");
  const out = fs.openSync(path.join(LOCAL, "db-start.log"), "a");
  spawn(process.execPath, [tsxCli, "--import", "./scripts/load-env.ts", "scripts/dev-db.ts"], { cwd: WEB, detached: true, stdio: ["ignore", out, out], windowsHide: true }).unref();
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await canConnect(host, port)) return true;
  }
  return false;
}

/** 連得上埠不代表可以查詢（剛啟動時回 57P03「starting up」）：真的查一次，最多等 180 秒。 */
async function waitQueryable(): Promise<boolean> {
  for (let i = 0; i < 90; i += 1) {
    try {
      await getSyncState("refresh_metacritic_index");
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return false;
}

async function main(): Promise<void> {
  if (!(await ensureDb()) || !(await waitQueryable())) {
    mark("failed", { reason: "資料庫無法使用" });
    return log("資料庫無法使用，今天略過");
  }
  mark("running", { startedAt: new Date().toISOString() });
  const dailyLimit = dailyRequestLimit();
  // 任務先用「上限 − 保留 − 補資料預留」；補資料那一步再放寬到「上限 − 保留」
  process.env.METACRITIC_DAILY_REQUEST_LIMIT = String(jobBudgetLimit(dailyLimit, MARGIN, FACTS_RESERVE));
  const jobs = enabledModules().flatMap((m) => m.jobs ?? []);
  const find = (name: string) => jobs.find((j) => j.name === name);
  if (!find("sync_ratings")) {
    mark("done", { note: "metacritic 模組未啟用" });
    return log("metacritic 模組未啟用，結束");
  }

  const remaining = async () => (await loadBudget()).remaining();
  const results: Record<string, number> = {};
  /** 跑一次任務；回傳這次用掉的請求數（-1＝任務失敗）。 */
  const run = async (name: string): Promise<number> => {
    const job = find(name);
    if (!job) return 0;
    const before = await remaining();
    const outcome = await runJobOnce(job, []);
    const used = before - (await remaining());
    log(`${name}：${outcome}，用掉 ${used} 個請求，今日剩 ${await remaining()}`);
    results[name] = (results[name] ?? 0) + Math.max(0, used);
    return outcome === "failed" ? -1 : used;
  };

  // 每週更新一次 slug 索引（讀 sitemap 分片，新遊戲才找得到）
  const idx = await getSyncState("refresh_metacritic_index");
  const idxAge = idx?.lastSuccessAt ? (Date.now() - new Date(idx.lastSuccessAt).getTime()) / 86_400_000 : Infinity;

  const plan = ["sync_ratings", "reverify_matches_metacritic", "repair_matches_metacritic", ...(idxAge >= INDEX_REFRESH_DAYS ? ["refresh_metacritic_index"] : []), "sync_ratings"];
  const exhausted = new Set<string>(); // 這個任務再跑也沒有新事可做（用掉 0 個請求）
  let runs = 0;
  let failures = 0;
  outer: for (const name of plan) {
    while (runs < MAX_RUNS) {
      if ((await remaining()) < MIN_USEFUL) break outer;
      if (exhausted.has(name) && name !== "sync_ratings") break;
      runs += 1;
      const used = await run(name);
      if (used < 0) {
        failures += 1;
        if (failures >= 3) break outer;
        break; // 這個任務失敗：換下一個，不重試
      }
      if (used < SMALL_RUN) {
        // 佇列已經見底（例如只剩幾筆一直解析失敗的頁面）：再跑只是白花請求
        exhausted.add(name);
        break;
      }
      if (name === "refresh_metacritic_index" || name === "sync_ratings") break; // 一輪就夠（索引每輪 40 片；分數已抓完會是 0）
    }
  }
  // 最後一步：補校驗頁需要的 Metacritic 頁面資料（發售日等）。額度上限放寬到只留保留量。
  process.env.METACRITIC_DAILY_REQUEST_LIMIT = String(Math.max(1, dailyLimit - MARGIN));
  let factsFetched = 0;
  try {
    const f = await runFactsStep({ max: FACTS_MAX, maxPriority: 1 });
    factsFetched = f.fetched;
    log(f.skipped ? `補頁面資料略過：${f.skipped}` : `補頁面資料：${f.fetched} 頁，用掉 ${f.requests} 個請求，今日剩 ${await remaining()}`);
  } catch (err) {
    log(`補頁面資料失敗：${err instanceof Error ? err.message : String(err)}`);
  }
  const left = await remaining();
  mark("done", { finishedAt: new Date().toISOString(), requestsByJob: results, factsFetched, remaining: left, failures });
  log(`完成：${JSON.stringify(results)}，補頁面資料 ${factsFetched} 頁，今日剩 ${left}`);
}

main()
  .catch((err) => {
    log(`失敗：${err instanceof Error ? err.message : String(err)}`);
    mark("failed", { reason: String(err instanceof Error ? err.message : err).slice(0, 300) });
  })
  .finally(async () => {
    await closeDb().catch(() => {});
    process.exit(0);
  });

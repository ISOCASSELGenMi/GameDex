// Claude 啟動時（SessionStart hook）呼叫：當天（UTC，和請求額度同一天）還沒抓過就在背景啟動 metacritic-daily.ts。
// 必須很快結束、不輸出任何東西（hook 的輸出會進對話）。沒有 .env.local（例如別台電腦、worktree）就什麼都不做。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

try {
  const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const root = path.resolve(web, "../..");
  const local = path.join(root, ".local");
  const marker = path.join(local, "metacritic-daily.json");
  const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  if (!fs.existsSync(path.join(web, ".env.local")) || !fs.existsSync(tsxCli)) process.exit(0);

  const day = new Date().toISOString().slice(0, 10);
  let m = null;
  try {
    m = JSON.parse(fs.readFileSync(marker, "utf8"));
  } catch {
    /* 沒有紀錄＝今天還沒跑 */
  }
  if (m && m.day === day) {
    const age = Date.now() - new Date(m.updatedAt ?? 0).getTime();
    if (m.state === "done") process.exit(0);
    if (m.state === "running" && age < 4 * 3_600_000) process.exit(0); // 另一個還在跑
    if (m.state === "failed" && age < 3_600_000) process.exit(0); // 剛失敗過，一小時內不重試
  }
  fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(marker, JSON.stringify({ day, state: "running", updatedAt: new Date().toISOString(), startedAt: new Date().toISOString() }, null, 1));
  const out = fs.openSync(path.join(local, "metacritic-daily.log"), "a");
  spawn(process.execPath, [tsxCli, "--import", "./scripts/load-env.ts", "scripts/metacritic-daily.ts"], { cwd: web, detached: true, stdio: ["ignore", out, out], windowsHide: true }).unref();
} catch {
  /* hook 絕不能因為這個擋住 Claude 啟動 */
}
process.exit(0);

/**
 * 本機開發用 PostgreSQL 16（embedded-postgres，二進位檔在 node_modules，資料在 repo 根目錄 .local/pgdata）。
 * 不安裝任何系統服務；正式環境用 Docker postgres:16（16 §docker-compose）。
 *
 *   npm run db:start   # 前景執行，Ctrl+C 停止
 *
 * 連線參數一律取自 DATABASE_URL（.env.local），只允許 localhost。
 */
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
  console.error(`DATABASE_URL 不是本機（${url.hostname}），db:start 只用於開發。`);
  process.exit(1);
}
const user = decodeURIComponent(url.username || "sok");
const password = decodeURIComponent(url.password || "sok");
const port = Number(url.port || 5432);
const database = url.pathname.replace(/^\//, "") || "sok_studio";

// pg_trgm 對中日文需要 UTF-8 且非 C／POSIX 的 locale（16 §docker-compose）。
const defaultLocale = process.platform === "win32" ? "en-US" : "C.UTF-8";
const locale = process.env.DEV_DB_LOCALE || defaultLocale;
const dataDir = path.resolve(process.cwd(), "../../.local/pgdata");

const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  persistent: true,
  authMethod: "scram-sha-256",
  initdbFlags: ["--encoding=UTF8", `--locale=${locale}`],
  // 容器內以 root 執行時 postgres 會拒絕啟動；只在 Linux root 下啟用。
  createPostgresUser: process.platform === "linux" && process.getuid?.() === 0,
  onLog: (m) => {
    if (process.env.DEV_DB_VERBOSE) console.log(String(m).trimEnd());
  },
});

async function ensureDatabase(): Promise<void> {
  const client = new pg.Client({ host: "localhost", port, user, password, database: "postgres" });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (!rowCount) {
      await client.query(`CREATE DATABASE "${database.replace(/"/g, '""')}" ENCODING 'UTF8' TEMPLATE template0`);
      console.log(`[dev-db] 已建立資料庫 ${database}`);
    }
    const { rows } = await client.query(
      "SELECT datcollate, datctype, pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = $1",
      [database],
    );
    console.log(`[dev-db] ${database}：encoding=${rows[0].enc} collate=${rows[0].datcollate} ctype=${rows[0].datctype}`);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const fs = await import("node:fs");
  if (!fs.existsSync(path.join(dataDir, "PG_VERSION"))) {
    console.log(`[dev-db] 初始化資料目錄 ${dataDir}（locale=${locale}）`);
    await server.initialise();
  }
  await server.start();
  await ensureDatabase();
  console.log(`[dev-db] PostgreSQL 已啟動：localhost:${port}/${database}（Ctrl+C 停止）`);

  const shutdown = async () => {
    console.log("\n[dev-db] 停止中…");
    await server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(async (err) => {
  console.error("[dev-db] 失敗：", err);
  await server.stop().catch(() => undefined);
  process.exit(1);
});

# SoK Game Calendar

遊戲資料庫＋上市月曆／時間軸。規格書在 claude.ai Project 的 `spec/`（v2.0），本 repo 依 `spec/15-路線圖.md` 分階段實作。

| 狀態 | 階段 |
| --- | --- |
| ✅ | Phase 0：環境（npm workspaces、Next.js 16、本機 PostgreSQL 16） |
| ✅ | Phase 1：kernel、catalog 資料模型、`lint:arch`、core-only CI |
| ⏳ | Phase 2：IGDB 同步（需要 Twitch Developer Console 的 Client ID／Secret） |

## 本機開發（Windows／macOS／Linux）

需要 Node.js 22 以上。**不需要安裝 PostgreSQL 或 Docker**：開發用資料庫由 `embedded-postgres` 提供（PG 16 二進位檔在 `node_modules`，資料在 `.local/pgdata`）。

```bash
npm install
copy apps\web\.env.example apps\web\.env.local   # macOS/Linux: cp

# 終端機 1：資料庫（前景執行，Ctrl+C 停止）
npm run db:start

# 終端機 2
npm run db:migrate
npm run db:seed
npm run dev                 # http://localhost:3000 、/healthz 、/readyz
```

## 常用指令

| 指令 | 用途 |
| --- | --- |
| `npm run typecheck` | `next typegen` ＋ `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run lint:arch` | 分層與模組邊界檢查（spec 02 §CI 邊界檢查 a、b、c） |
| `npm test` | 單元＋整合測試（整合測試需要 `TEST_DATABASE_URL`，未設定時自動跳過） |
| `npm run db:generate` | schema 改動後產生 migration |
| `npm -w apps/web run db:trgm-test` | pg_trgm 中日文實測 |

## 結構

```
apps/web/src/
├── kernel/          db/ config/ scheduler/ modules/ request-context.ts（不 import 任何模組）
├── modules/
│   ├── registry.ts  唯一會 import 可選模組的地方
│   └── catalog/     domain/entities/ repository/ schema.ts module.ts index.ts seed.ts
├── app/             只放薄路由（目前：/healthz、/readyz、佔位首頁）
├── instrumentation.ts → bootstrap.ts（啟動檢查、排程註冊）
apps/web/drizzle/    migration（0000 啟用 pg_trgm）
apps/web/test/       unit/ integration/ arch-fixtures/（lint:arch 的刻意違規範例）
infra/.env.example   全部環境變數（spec 16）
```

正式部署（Docker Compose＋Caddy＋Cloudflare）在 Phase 9。

/**
 * 架構邊界檢查（02 §CI 邊界檢查 a、b、c）：npm run lint:arch
 * 路徑相對於 apps/web；需 TypeScript < 7（實測 6.0.3）。
 */
const OPTIONAL = "(accounts|discord|notifications|awards|social|admin|metacritic)";

module.exports = {
  forbidden: [
    // ── b：模組邊界 ──────────────────────────────────────────────
    {
      name: "kernel-no-modules",
      comment: "kernel 不 import 任何模組（邊界規則 1）",
      severity: "error",
      from: { path: "^src/kernel/" },
      to: { path: "^src/modules/" },
    },
    {
      name: "catalog-no-optional",
      comment: "catalog 永遠不 import 可選模組（原則四）",
      severity: "error",
      from: { path: "^src/modules/catalog/" },
      to: { path: `^src/modules/${OPTIONAL}/` },
    },
    {
      name: "only-registry-and-app-import-optional",
      comment: "只有 modules/registry.ts 與 app/ 的薄路由可以 import 可選模組（邊界規則 3）",
      severity: "error",
      from: { pathNot: [`^src/app/`, `^src/modules/registry\\.ts$`, `^src/modules/${OPTIONAL}/`] },
      to: { path: `^src/modules/${OPTIONAL}/` },
    },
    {
      name: "no-deep-import",
      comment: "跨模組只能經由對方的 index.ts（邊界規則 2）",
      severity: "error",
      from: { path: "^src/modules/([^/]+)/" },
      to: { path: "^src/modules/[^/]+/", pathNot: ["^src/modules/$1/", "^src/modules/[^/]+/index\\.ts$"] },
    },
    {
      name: "app-no-deep-import",
      comment: "薄路由與 registry 也只能 import 模組的公開 API、api/ 處理器或 ui/index.ts、ui/client.ts（頁面內容，06：內容在 modules/<name>/ui/）",
      severity: "error",
      from: { path: ["^src/app/", "^src/modules/registry\\.ts$", "^src/bootstrap\\.ts$"] },
      to: {
        path: "^src/modules/[^/]+/",
        pathNot: ["^src/modules/[^/]+/index\\.ts$", "^src/modules/[^/]+/api/", "^src/modules/[^/]+/ui/(index|client)\\.ts$"],
      },
    },
    {
      name: "schema-only-own-repository",
      comment: "schema.ts 只能被 repository 使用（跨模組的情況另由 no-deep-import 擋下）；kernel/db 例外",
      severity: "error",
      from: { pathNot: ["/repository/", "^src/kernel/db/"] },
      to: { path: "/schema\\.ts$" },
    },

    // ── a：分層規則 1~5 ─────────────────────────────────────────
    {
      name: "domain-is-pure",
      comment: "Domain 不 import 其他層與第三方套件（zod 例外）",
      severity: "error",
      from: { path: "/domain/" },
      to: { pathNot: ["/domain/", "node_modules/zod/"] },
    },
    {
      name: "repo-no-provider",
      severity: "error",
      from: { path: "/repository/" },
      to: { path: "/providers?/" },
    },
    {
      name: "repo-no-usecase",
      severity: "error",
      from: { path: "/repository/" },
      to: { path: "/use-cases/" },
    },
    {
      name: "provider-no-repo-or-usecase",
      severity: "error",
      from: { path: "/providers?/" },
      to: { path: ["/repository/", "/use-cases/"] },
    },
    {
      name: "presentation-no-provider-or-repo",
      comment: "Presentation（app、ui、api）只 import Use Case 與 Domain 型別",
      severity: "error",
      from: { path: ["^src/app/", "/ui/", "^src/modules/[^/]+/api/"] },
      to: { path: ["/providers?/", "/repository/", "\\bschema\\.ts$"] },
    },

    // ── c：drizzle 只在 repository 與 kernel/db ────────────────────
    {
      name: "drizzle-only-in-repository",
      severity: "error",
      from: { pathNot: ["/repository/", "/schema\\.ts$", "^src/kernel/db/"] },
      to: { path: "node_modules/drizzle-orm/" },
    },
    {
      name: "db-client-only-in-repository",
      comment: "db.* 只出現在 repository/ 與 kernel/（不 import drizzle 也拿得到 getDb()，所以另外擋）",
      severity: "error",
      from: { pathNot: ["/repository/", "^src/kernel/", "/seed\\.ts$"] },
      to: { path: "^src/kernel/db/(client|schema)\\.ts$" },
    },
    {
      name: "pg-only-in-kernel-db",
      comment: "原生 pg 連線只在 kernel/db（scripts/ 不在 src 內，不受此限）",
      severity: "error",
      from: { pathNot: ["^src/kernel/db/"] },
      to: { path: "node_modules/pg/" },
    },

    // ── 一般衛生 ────────────────────────────────────────────────
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    exclude: { path: "\\.next/" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "node", "default", "types"] },
  },
};

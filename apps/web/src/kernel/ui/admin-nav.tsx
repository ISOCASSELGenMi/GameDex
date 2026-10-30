/**
 * /internal/* 各頁共用的導覽（12）：回報、使用者、設定、同步監控（Metacritic 啟用時再多「比對覆核」）。
 * 放在 kernel/ui：admin 與 accounts 兩個模組的頁面都要用，而模組之間不能互相 import。
 * 只列目前啟用的模組提供的頁面（accounts 沒啟用就沒有「使用者」）。內部頁面文字固定 zh-Hant。
 */
import type { ReactElement } from "react";
import type { EnvLike } from "../config/env";
import { isModuleEnabled } from "../modules/enabled";

export type AdminNavKey = "reports" | "igdb-feedback" | "users" | "settings" | "sync" | "matches";

export interface AdminNavItem {
  key: AdminNavKey;
  href: string;
  label: string;
}

/** 目前啟用的內部頁面（純函式，供測試）。 */
export function adminNavItems(env: EnvLike = process.env): AdminNavItem[] {
  const items: AdminNavItem[] = [
    { key: "reports", href: "/internal/reports", label: "資料更正回報" },
    { key: "igdb-feedback", href: "/internal/igdb-feedback", label: "待回饋 IGDB" },
  ];
  if (isModuleEnabled("accounts", env)) items.push({ key: "users", href: "/internal/users", label: "使用者管理" });
  items.push({ key: "settings", href: "/internal/settings", label: "網站設定" });
  items.push({ key: "sync", href: "/internal/sync", label: "同步監控" });
  if (isModuleEnabled("metacritic", env)) items.push({ key: "matches", href: "/internal/matches", label: "Metacritic 比對覆核" });
  return items;
}

export function AdminNav({ current }: { current: AdminNavKey }): ReactElement {
  return (
    <nav aria-label="內部頁面" data-admin-nav="">
      <ul className="flex flex-wrap gap-2">
        {adminNavItems().map((item) => (
          <li key={item.key}>
            <a
              className="link-quiet inline-flex min-h-11 items-center rounded-md px-2 aria-[current=page]:font-semibold aria-[current=page]:underline"
              href={item.href}
              aria-current={item.key === current ? "page" : undefined}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

"use client";
/**
 * 跟著目前網址走的語言選單：帳號頁殼（GameDex 第 2 段）的分頁切換是客戶端導覽，header 由共用版面渲染、不會跟著重繪，
 * 所以連結要依「目前的 pathname」在客戶端換語系前綴（`/en/account/lists` → `/ja/account/lists`），不能用伺服器端算好的固定網址。
 * 伺服器端（含無 JS）仍是 `items` 的網址（版面指定的路徑）。
 */
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";
import { LanguageMenu, type LanguageMenuItem } from "./language-menu";

export function FollowingLanguageMenu({ items, label, triggerLabel }: { items: readonly LanguageMenuItem[]; label: string; triggerLabel: string }): ReactElement {
  const pathname = usePathname();
  const rest = pathname.replace(/^\/[^/]+/, "");
  const followed = rest ? items.map((item) => ({ ...item, href: `/${item.locale}${rest}` })) : items;
  return <LanguageMenu items={followed} label={label} triggerLabel={triggerLabel} />;
}

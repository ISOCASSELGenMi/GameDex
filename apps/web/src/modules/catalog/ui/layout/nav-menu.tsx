"use client";
/**
 * header 左側的導覽下拉（品牌旁的小格按鈕）。目前頁以 aria-current="page" 標示。
 * `currentPath`（去掉語系前綴）由頁面給；帳號頁殼這類跨頁共用版面用 FollowingNavMenu 改讀客戶端的 pathname。
 */
import { usePathname } from "next/navigation";
import type { ReactElement, ReactNode } from "react";
import { Dropdown } from "@/kernel/ui/dropdown";
import { GridIcon } from "@/kernel/ui/header-icons";
import { isCurrentNav, stripLocalePrefix, type NavItem } from "./nav-items";

export interface NavMenuProps {
  items: readonly NavItem[];
  currentPath: string;
  label: string;
  navLabel: string;
  /** 清單最後（窄螢幕才出現的組織首頁連結）。 */
  footer?: ReactNode;
}

export function NavMenu({ items, currentPath, label, navLabel, footer }: NavMenuProps): ReactElement {
  return (
    <Dropdown name="nav" label={label} icon={<GridIcon />} align="start">
      <nav aria-label={navLabel}>
        <ul className="dd-list">
          {items.map((item) => (
            <li key={item.path}>
              <a href={item.href} className="dd-item" data-brand={item.brand} aria-current={isCurrentNav(item, currentPath) ? "page" : undefined}>
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {footer}
    </Dropdown>
  );
}

export function FollowingNavMenu(props: Omit<NavMenuProps, "currentPath">): ReactElement {
  return <NavMenu {...props} currentPath={stripLocalePrefix(usePathname())} />;
}

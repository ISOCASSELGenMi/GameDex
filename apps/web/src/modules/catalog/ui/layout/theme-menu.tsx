"use client";
/**
 * header 的主題下拉：系統（預設）／亮色／暗色，加上已解鎖的隱藏主題（彩蛋；kernel/ui/unlocks.ts）。
 * 偏好存 localStorage、套到 <html data-theme>（kernel/ui/theme）。
 * 伺服器 HTML 與使用者無關：首次渲染一律「系統」且不含隱藏主題，水合後才讀 localStorage（目前選項、已解鎖主題）
 * （畫面本身的明暗由 <head> 的 inline script 在首次繪製前套用，不依賴這個元件）。
 */
import { useSyncExternalStore, type ReactElement } from "react";
import { Dropdown, useDropdownClose } from "@/kernel/ui/dropdown";
import { ThemeIcon } from "@/kernel/ui/header-icons";
import { getServerThemeSnapshot, getThemeSnapshot, selectTheme, subscribeTheme } from "@/kernel/ui/theme-controller";
import { NO_UNLOCKS, getUnlockStore } from "@/kernel/ui/unlock-store";

export interface ThemeMenuProps {
  label: string;
  /** 基本選項（系統、亮、暗）與其顯示文字。 */
  options: readonly { id: string; label: string }[];
  /** 隱藏主題與其顯示文字；解鎖後才出現在選單。 */
  hiddenOptions?: readonly { id: string; label: string }[];
}

export function ThemeMenu({ label, options, hiddenOptions = [] }: ThemeMenuProps): ReactElement {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
  const store = typeof window === "undefined" ? null : getUnlockStore();
  const records = useSyncExternalStore(
    (fn) => (store ? store.subscribe(fn) : () => {}),
    () => (store ? store.getSnapshot() : NO_UNLOCKS),
    () => NO_UNLOCKS,
  );
  const unlocked = new Set(records.filter((r) => r.type === "theme").map((r) => r.key));
  const all = [...options, ...hiddenOptions.filter((o) => unlocked.has(o.id))];
  return (
    <Dropdown name="theme" label={label} icon={<ThemeIcon />} align="end">
      <ThemeOptions theme={theme} options={all} />
    </Dropdown>
  );
}

function ThemeOptions({ theme, options }: { theme: string; options: ThemeMenuProps["options"] }): ReactElement {
  const close = useDropdownClose();
  return (
    <ul className="dd-list">
      {options.map((o) => (
        <li key={o.id}>
          <button
            type="button"
            className="dd-item"
            aria-pressed={theme === o.id}
            data-theme-option={o.id}
            onClick={(e) => {
              selectTheme(o.id);
              close(e.detail === 0);
            }}
          >
            {o.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

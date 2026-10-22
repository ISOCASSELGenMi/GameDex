"use client";
/**
 * header 的主題下拉：系統（預設）／亮色／暗色。偏好存 localStorage、套到 <html data-theme>（kernel/ui/theme）。
 * 伺服器 HTML 與使用者無關：首次渲染一律「系統」，水合後才讀 localStorage 標出目前選項
 * （畫面本身的明暗由 <head> 的 inline script 在首次繪製前套用，不依賴這個元件）。
 */
import { useSyncExternalStore, type ReactElement } from "react";
import { Dropdown, useDropdownClose } from "@/kernel/ui/dropdown";
import { ThemeIcon } from "@/kernel/ui/header-icons";
import { THEME_STORAGE_KEY, applyTheme, readTheme, writeTheme } from "@/kernel/ui/theme";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // 其他分頁改了主題 → 套用並跟著變
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== THEME_STORAGE_KEY) return;
    applyTheme(readTheme(), document.documentElement);
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export interface ThemeMenuProps {
  label: string;
  /** 已排除 locked 的選項與其顯示文字。 */
  options: readonly { id: string; label: string }[];
}

export function ThemeMenu({ label, options }: ThemeMenuProps): ReactElement {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system");
  return (
    <Dropdown name="theme" label={label} icon={<ThemeIcon />} align="end">
      <ThemeOptions theme={theme} options={options} />
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
              writeTheme(o.id);
              applyTheme(o.id, document.documentElement);
              notify();
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

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UNLOCK_THEME_KEYS } from "@/kernel/ui/unlocks";

const css = readFileSync(path.join(__dirname, "..", "..", "src", "app", "themes.css"), "utf8");

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const ratio = (a: string, b: string): number => {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

function tokens(theme: string): Record<string, string> {
  const m = new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`).exec(css);
  expect(m, `themes.css 缺少 ${theme}`).not.toBeNull();
  const out: Record<string, string> = {};
  for (const line of m![1]!.split("\n")) {
    const t = /--([\w-]+):\s*(#[0-9a-fA-F]{6});/.exec(line);
    if (t) out[t[1]!] = t[2]!;
  }
  return out;
}

describe("隱藏主題 token 對比（WCAG AA）", () => {
  it.each(UNLOCK_THEME_KEYS)("%s：文字 4.5:1、按鈕 4.5:1、焦點框 3:1", (theme) => {
    const t = tokens(theme);
    for (const key of ["background", "foreground", "muted", "surface", "surface-strong", "panel", "link", "on-link", "accent-2", "warn", "danger", "up", "today", "focus"])
      expect(t[key], `${theme} 缺 --${key}`).toBeTruthy();
    const fails: string[] = [];
    for (const bg of ["background", "panel", "surface", "surface-strong"])
      for (const fg of ["foreground", "muted", "link", "accent-2", "warn", "danger", "up"]) {
        const r = ratio(t[fg]!, t[bg]!);
        if (r < 4.5) fails.push(`${fg} on ${bg} = ${r.toFixed(2)}`);
      }
    for (const [fg, bg, min] of [
      ["on-link", "link", 4.5],
      ["foreground", "today", 4.5],
      ["link", "today", 4.5],
      ["muted", "today", 4.5],
      ["focus", "background", 3],
      ["focus", "panel", 3],
    ] as const) {
      const r = ratio(t[fg]!, t[bg]!);
      if (r < min) fails.push(`${fg} on ${bg} = ${r.toFixed(2)} < ${min}`);
    }
    expect(fails).toEqual([]);
  });
  it("不使用 transition: all；crossfade 只動色彩屬性", () => {
    expect(css).not.toMatch(/transition:\s*all/);
    expect(css).toMatch(/html\.theme-fade/);
  });
});

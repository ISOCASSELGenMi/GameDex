/** Phase 7 第 5 波畫面：評分／耗時換算與格式化、欄位錯誤碼文案、UI 原始碼引用的字典 key 三語都存在。 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MESSAGES, flattenMessages, type Locale } from "@sok/i18n";
import { PLAY_STATUSES } from "@/modules/accounts/domain/entities/play-records";
import { fieldErrorText, formatPlayTime, formatRating, formatScore, joinMinutes, playStatusLabel, ratingOptions, splitMinutes } from "@/modules/accounts/ui/play-format";
import { accountStrings } from "@/modules/accounts/ui/strings";
import { publicListHref } from "@/modules/accounts/ui/links";

const LOCALES: Locale[] = ["zh-Hant", "en", "ja"];

describe("評分（半分級 1~20 ↔ 0.5~10）", () => {
  it("選項共 20 個，由 0.5 到 10", () => {
    const o = ratingOptions("en");
    expect(o).toHaveLength(20);
    expect(o[0]).toEqual({ value: 1, label: "0.5" });
    expect(o[1]).toEqual({ value: 2, label: "1" });
    expect(o[18]).toEqual({ value: 19, label: "9.5" });
    expect(o[19]).toEqual({ value: 20, label: "10" });
  });
  it("formatRating／formatScore 依 locale 用小數符號", () => {
    expect(formatRating(17, "en")).toBe("8.5");
    expect(formatRating(17, "zh-Hant")).toBe("8.5");
    expect(formatRating(20, "ja")).toBe("10");
    expect(formatScore(8.5, "en")).toBe("8.5");
    expect(formatScore(7, "en")).toBe("7");
  });
});

describe("耗時（小時＋分鐘 ↔ 分鐘）", () => {
  it("splitMinutes", () => {
    expect(splitMinutes(0)).toEqual({ hours: 0, minutes: 0 });
    expect(splitMinutes(90)).toEqual({ hours: 1, minutes: 30 });
    expect(splitMinutes(600_000)).toEqual({ hours: 10_000, minutes: 0 });
  });
  it("joinMinutes：兩欄皆空＝未填；只填一欄；非數字／負數／小數＝invalid；超過 600000 分鐘＝out_of_range", () => {
    expect(joinMinutes("", "")).toEqual({ ok: true, minutes: null });
    expect(joinMinutes(" ", " ")).toEqual({ ok: true, minutes: null });
    expect(joinMinutes("2", "")).toEqual({ ok: true, minutes: 120 });
    expect(joinMinutes("", "45")).toEqual({ ok: true, minutes: 45 });
    expect(joinMinutes("1", "90")).toEqual({ ok: true, minutes: 150 });
    expect(joinMinutes("0", "0")).toEqual({ ok: true, minutes: 0 });
    expect(joinMinutes("10000", "0")).toEqual({ ok: true, minutes: 600_000 });
    expect(joinMinutes("10000", "1")).toEqual({ ok: false, code: "out_of_range" });
    for (const bad of [["-1", ""], ["1.5", ""], ["", "x"], ["1e3", ""], ["12345678", ""]] as const) {
      expect(joinMinutes(bad[0], bad[1]), bad.join("|")).toEqual({ ok: false, code: "invalid" });
    }
  });
  it("splitMinutes 與 joinMinutes 互逆", () => {
    for (const total of [0, 1, 59, 60, 61, 1234, 600_000]) {
      const { hours, minutes } = splitMinutes(total);
      expect(joinMinutes(String(hours), String(minutes))).toEqual({ ok: true, minutes: total });
    }
  });
  it("formatPlayTime 三種寫法（三語）", () => {
    const zh = accountStrings("zh-Hant");
    expect(formatPlayTime(zh, 750)).toBe("12 小時 30 分");
    expect(formatPlayTime(zh, 720)).toBe("12 小時");
    expect(formatPlayTime(zh, 45)).toBe("45 分");
    expect(formatPlayTime(zh, 0)).toBe("0 分");
    const en = accountStrings("en");
    expect(formatPlayTime(en, 750)).toBe("12 h 30 min");
    const ja = accountStrings("ja");
    expect(formatPlayTime(ja, 750)).toBe("12 時間 30 分");
  });
});

describe("狀態與欄位錯誤文案", () => {
  it("六種狀態三語都有文案", () => {
    for (const locale of LOCALES) {
      const s = accountStrings(locale);
      for (const st of PLAY_STATUSES) expect(playStatusLabel(s, st), `${locale}:${st}`).not.toBe(`play.status.${st}`);
    }
  });
  it("API 欄位錯誤碼都有文案；未知的碼退回「格式不正確」", () => {
    for (const locale of LOCALES) {
      const s = accountStrings(locale);
      for (const code of ["required", "invalid", "too_long", "out_of_range", "duplicate", "too_many", "empty", "immutable", "before_started_on", "not_in_game"]) {
        expect(fieldErrorText(s, code), `${locale}:${code}`).not.toMatch(/^error\.field\./);
      }
      expect(fieldErrorText(s, "something_new")).toBe(fieldErrorText(s, "invalid"));
    }
  });
});

describe("公開清單網址", () => {
  it("public 用 id；unlisted 有 token 用分享網址（編碼）", () => {
    expect(publicListHref("en", { id: 7, visibility: "public", shareToken: null })).toBe("/en/lists/7");
    expect(publicListHref("ja", { id: 7, visibility: "unlisted", shareToken: "abc_DEF-12345678" })).toBe("/ja/lists/s/abc_DEF-12345678");
    expect(publicListHref("ja", { id: 7, visibility: "unlisted", shareToken: null })).toBe("/ja/lists/7");
  });
});

describe("UI 原始碼引用的字典 key 三語都存在", () => {
  const uiDir = path.resolve(__dirname, "../../src/modules/accounts/ui");
  const files = readdirSync(uiDir).filter((f) => /\.(tsx?|ts)$/.test(f));
  const used = new Set<string>();
  for (const f of files) {
    const src = readFileSync(path.join(uiDir, f), "utf8");
    // str(strings, "a.b.c" …) 與 str(s, "a.b.c" …)：只收字面值（含動態前綴的樣板字串另外列舉）
    for (const m of src.matchAll(/\bstr\(\s*\w+,\s*"([A-Za-z0-9_.]+)"/g)) used.add(m[1]!);
  }
  // 動態 key：由程式組合
  for (const st of PLAY_STATUSES) used.add(`play.status.${st}`);
  for (const v of ["public", "unlisted", "private"]) used.add(`list.visibility.${v}`);
  for (const v of ["public", "followers", "private"]) used.add(`play.visibility.${v}`);
  for (const f of ["all", "needs_review", "not_found", "dismissed", "matched"]) used.add(`steam.filter.${f}`);
  for (const st of ["matched", "needs_review", "not_found", "queued", "dismissed"]) used.add(`steam.status.${st}`);

  it("有引用到 key（掃描有效）", () => {
    expect(used.size).toBeGreaterThan(80);
  });
  for (const locale of LOCALES) {
    it(`${locale} 全部存在`, () => {
      const keys = new Set(flattenMessages(MESSAGES[locale].accounts).keys());
      const missing = [...used].filter((k) => !keys.has(k));
      expect(missing).toEqual([]);
    });
  }
});

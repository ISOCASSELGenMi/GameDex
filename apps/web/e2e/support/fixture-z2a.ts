/**
 * GameDex 第 2 輪 Z2A（瀏覽頁分組檢視）的 e2e fixture 固定值（seed-z2a.ts 寫入、測試斷言共用；不 import 任何 DB 程式）。
 * 遊戲名稱都帶 "Z2A"，測試以 `q=z2a` 隔離其他 fixture 的遊戲。日期固定在 2036-09～2037，不依賴「今天」。igdbId 446xxx。
 */
export const FIXTURE_Z2A = {
  q: "z2a",
  /** 同一月三款（2036-09-10）：FromSoftware 開發＋萬代南夢宮發行、任天堂發行（開發商不在名單）、獨立；另有卡普空（09-20）。 */
  month: "2036-09",
  elden: { slug: "e2e-z2a-elden", name: "Z2A Elden Test" },
  zelda: { slug: "e2e-z2a-zelda", name: "Z2A Zelda Test" },
  indie: { slug: "e2e-z2a-indie", name: "Z2A Indie Test" },
  capcom: { slug: "e2e-z2a-capcom", name: "Z2A Capcom Test" },
  /** 36 款同一天（> 首屏 8 張＋一次 24 張 → 要按兩次「顯示更多」）。 */
  bulk: { day: "2036-09-15", count: 36 },
  /** 季精度（2036-Q4）、年精度（2037）、日期未定（沒有平台）。 */
  quarter: { slug: "e2e-z2a-quarter", name: "Z2A Quarter Test" },
  year: { slug: "e2e-z2a-year", name: "Z2A Year Test" },
  undated: { slug: "e2e-z2a-undated", name: "Z2A Undated Test" },
  /** 日期組（熱度排序＝由新到舊）。 */
  dateGroups: ["2037", "2036-Q4", "2036-09", "tbd"],
  /** 該月總數：4＋36。 */
  monthTotal: 40,
  /** e2e 平台（seed.ts 建立）。 */
  platforms: { ps5: "e2e-ps5", switch: "e2e-switch", pc: "e2e-pc" },
} as const;

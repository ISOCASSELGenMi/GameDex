/**
 * GameDex 第 2 輪 Z4B（遊戲詳情頁補資訊）的 e2e fixture 固定值（seed-z4b.ts 寫入、測試斷言共用；不 import 任何 DB 程式）。
 * 遊戲名稱都帶 "Z4B"；日期固定在 2038，不依賴「今天」。igdbId 447xxx。
 * 主作有：版本（Switch 2 Edition）、26 款 DLC（超過每組上限 24）、資料片、移植、本地化標題、別名、模式、視角、引擎、故事、預告片。
 */
export const FIXTURE_Z4B = {
  main: { slug: "e2e-z4b-main", name: "Z4B Main Quest", igdbId: 447001, date: "2038-02-10" },
  edition: { slug: "e2e-z4b-switch2", name: "Z4B Main Quest Nintendo Switch 2 Edition", versionTitle: "Nintendo Switch 2 Edition" },
  /** 第 1 款 DLC 用來測 DLC 詳情頁。 */
  dlc: { prefix: "e2e-z4b-dlc-", count: 26, limit: 24 },
  expansion: { slug: "e2e-z4b-expansion", name: "Z4B Main Quest Expansion" },
  port: { slug: "e2e-z4b-port", name: "Z4B Main Quest Port" },
  /** 沒有任何補資訊的一般遊戲：About 區整區不顯示，也沒有「其他版本」列。 */
  plain: { slug: "e2e-z4b-plain", name: "Z4B Plain Game", date: "2038-03-01" },
  /** 相關內容總數：1 版本 + 26 DLC + 1 資料片 + 1 移植。 */
  relatedTotal: 29,
  storyStart: "Z4B story begins",
  localized: [
    { localeCode: "ja", name: "Z4B メインクエスト" },
    { localeCode: "ko", name: "Z4B 메인 퀘스트" },
  ],
  alternative: [
    { name: "Z4B MQ", comment: "Acronym" },
    { name: "Z4B 主線任務", comment: "Chinese title - traditional" },
  ],
  platforms: { ps5: "e2e-ps5", switch: "e2e-switch" },
} as const;

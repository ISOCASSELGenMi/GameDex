/** e2e fixture 的固定值（seed.ts 寫入、測試斷言共用；不 import 任何 DB 程式）。 */
export const FIXTURE_MONTH = "2036-05";
export const FIXTURE = {
  month: FIXTURE_MONTH,
  prevMonth: "2036-04",
  nextMonth: "2036-06",
  multiPlatformDay: "2036-05-15",
  busyDay: "2036-05-08",
  busyCount: 8,
  eventDay: "2036-05-12",
  hero: { slug: "e2e-aurora-odyssey", name: "Aurora Odyssey", zhName: "極光奧德賽" },
  monthPrecision: { slug: "e2e-month-precision", name: "Misty Month Game" },
  event: { name: "E2E Showcase 2036" },
  platformPs5: "e2e-ps5",
  platformSwitch: "e2e-switch",
  genreRpg: "role-playing-rpg",
  genreShooter: "shooter",
} as const;

/**
 * Wave 3（3b）追加的 fixture（igdbId 441xxx 區段；與上面的 440xxx 不重疊）。
 * - 時間軸：2037-03 一整個月。03-02 單日 13 款（> 預覽上限 10 → 「展開剩 3 款」）；另有 90 款填充分散在 03-03 起，
 *   讓 `at=2037-03-01` 的第一頁（60 筆）後面還有下一頁（「載入更多」）。
 * - 同 slug 的系列／合集：Twin Saga（franchise 與 collection 同 slug）。
 * - 語言支援三態：hero＝有資料（三欄都有）、partial＝只有介面（字幕、語音兩欄「未提供資料」）、Aurora Prequel＝整區尚無資料。
 * - 活動：另一個 expo（2036-06）、已結束的 awards（2020）、時間未定的 expo。
 */
export const FIXTURE_3B = {
  timeline: {
    month: "2037-03",
    anchor: "2037-03-01",
    bigDay: "2037-03-02",
    bigDayCount: 13,
    bigDayPreview: 10,
    fillerCount: 90,
  },
  /** 稀疏條件（W3C）：status=delayed（有延期紀錄）的遊戲只有兩款，一款在 2036-05-15（hero），一款在 2032-06（相距超過單次掃描上限 1190 天）。 */
  sparse: { slug: "e2e-far-delayed", name: "Far Delayed Fable", date: "2032-06-01", at: "2037-03-20" },
  twin: { slug: "e2e-twin-saga", name: "Twin Saga", franchiseGames: 2, collectionGames: 2 },
  langPartial: { slug: "e2e-lang-partial", name: "Partial Language Game" },
  langNone: { slug: "e2e-aurora-prequel" },
  events: {
    showcase: { slug: "e2e-showcase-2036", name: "E2E Showcase 2036" },
    expo: { slug: "e2e-expo-2036", name: "E2E Expo 2036" },
    past: { slug: "e2e-awards-2020", name: "E2E Awards 2020" },
    undated: { slug: "e2e-tbd-expo", name: "E2E To Be Announced Expo" },
  },
  searchTerm: "Aurora",
  /** 瀏覽頁：fixture 遊戲總數遠大於 24（一頁），才有下一頁。 */
  browsePageSize: 24,
} as const;

/**
 * Phase 4（評分）：hero 有 IGDB 分數；month-precision 只有 score=NULL 的列；Aurora Prequel 完全沒有列。
 * 兩款「無分數」的遊戲都不該顯示評分區。
 */
export const FIXTURE_4 = {
  rated: { slug: "e2e-aurora-odyssey", score: 82, reviewCount: 12 },
  nullRow: { slug: "e2e-month-precision" },
  noRow: { slug: "e2e-aurora-prequel" },
} as const;

/**
 * GameDex 第 2 段（首頁儀表板）：日期相對於 seed 當天（UTC），所以只放天數偏移。
 * 即將上市＝今天起 30 天內（day 精度）、最新上市＝過去 30 天內。近期活動沿用既有 fixture 的即將舉行活動（首頁的活動區不設時間上限，只取最近的 6 筆）。
 */
export const FIXTURE_HOME = {
  upcoming: [
    { slug: "e2e-home-up-1", name: "Home Upcoming One", offset: 3 },
    { slug: "e2e-home-up-2", name: "Home Upcoming Two", offset: 12 },
  ],
  recent: [
    { slug: "e2e-home-rc-1", name: "Home Recent One", offset: -4 },
    { slug: "e2e-home-rc-2", name: "Home Recent Two", offset: -20 },
  ],
} as const;

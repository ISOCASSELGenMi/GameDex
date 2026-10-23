/**
 * GameDex 第 2 輪 Z2B（評分排名）的 e2e fixture 常數。分數掛在既有的時間軸 fixture 遊戲上（e2e-big-NN、e2e-fill-NN），不新增遊戲，
 * 所以不影響其他測試對遊戲數量的斷言；詳情頁多出的分數只出現在這些遊戲上。
 */
export const FIXTURE_Z2B = {
  /** slug → [IGDB 分數, IGDB 評分人數] */
  igdb: {
    "e2e-big-01": [95, 50],
    "e2e-big-02": [90, 40],
    "e2e-big-03": [90, 30],
    "e2e-big-04": [85, 12],
    "e2e-big-05": [80, 9], // 人數不足預設門檻 10
    "e2e-big-06": [70, 100],
    "e2e-big-08": [99, 3], // 人數不足
  } as Record<string, [number, number]>,
  /** e2e-fill-00..59：分數 69 → 50（每 3 款降 1），人數 20 → IGDB 預設門檻內共 66 款（含 hero），超過一頁（50） */
  fillerCount: 60,
  /** slug → [玩家平均 0~100, 人數]（只放達預設門檻 5 的，模擬 publish_player_ratings 的結果） */
  players: {
    "e2e-fill-02": [99, 9],
    "e2e-big-04": [90, 6],
    "e2e-big-01": [80, 8],
    "e2e-fill-10": [75, 5],
    "e2e-big-06": [60, 5],
  } as Record<string, [number, number]>,
  /** 5 + 60，再加既有 fixture 的 hero（e2e-aurora-odyssey，82 分、12 人）。 */
  eligibleDefault: 66,
  playersEligible: 5,
} as const;

export const fillerScore = (i: number): number => 69 - Math.floor(i / 3);

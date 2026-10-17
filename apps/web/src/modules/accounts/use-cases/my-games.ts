/**
 * 「我的遊戲」（Phase 7 第 6 波）：mine 篩選解析 → catalog 的 getMyGames（聚合規則在 catalog，這裡不另寫）。
 * 頁面 HTML 不得含使用者資訊（06、D60），所以 mine 不進伺服器渲染的月曆／時間軸／瀏覽頁，只經這支需要登入的 API。
 */
import { getMyGames, MY_GAMES_IDS_MAX, type IsoDate, type MyGamesPage } from "@/modules/catalog";
import { isMineValue, mineGameFilter } from "./catalog-extensions";

/** mine 參數最多幾個值。 */
export const MINE_VALUES_MAX = 20;

export type MyGamesResult =
  | { ok: true; mine: string[]; page: MyGamesPage }
  | { ok: false; code: "list_not_found" };

/** 解析 `mine=followed,list:3`：去重、保留順序；空或有不合法的值 → null。 */
export function parseMineParam(raw: string | null): string[] | null {
  if (raw === null) return null;
  const values = [...new Set(raw.split(",").map((v) => v.trim()).filter((v) => v !== ""))];
  if (values.length === 0 || values.length > MINE_VALUES_MAX || !values.every(isMineValue)) return null;
  return values;
}

export async function getMyGamesPage(
  userId: number,
  input: { mine: string[]; from?: IsoDate | null; to?: IsoDate | null; limit?: number; offset?: number; locale: string | null },
): Promise<MyGamesResult> {
  const ids = new Set<number>();
  for (const value of input.mine) {
    const resolved = await mineGameFilter.resolve(userId, value);
    if (resolved === null) return { ok: false, code: "list_not_found" };
    for (const id of resolved) ids.add(id);
  }
  const page = await getMyGames({
    gameIds: [...ids].slice(0, MY_GAMES_IDS_MAX),
    from: input.from,
    to: input.to,
    limit: input.limit,
    offset: input.offset,
    locale: input.locale,
  });
  return { ok: true, mine: input.mine, page };
}

/**
 * IGDB `popularity_primitives` → 我方 ExternalHypeRecord（03 §熱度、原則二：popularity_type 數字只在這裡）。
 *
 * 2026-10-13 實測（唯讀）：popularity_types 2＝"Want to Play"（source 121＝IGDB，約 10 萬筆，value 是占比）、
 * 10＝"Most Wishlisted Upcoming"（source 1＝Steam，約 4,900 筆，value 依名次等距遞減）；與 spec 03 一致。
 * 每個種類整批重算（同一種類的 calculated_at 相同，約每日一次），所以用 calculated_at 當版本，沒變就不重抓。
 */
import type { ExternalHypeKind, ExternalHypeRecord, ExternalHypeVersion } from "../../domain/entities";

/** IGDB popularity_type id → 我方種類。 */
export const IGDB_POPULARITY_TYPES: Readonly<Record<number, ExternalHypeKind>> = {
  2: "want_to_play",
  10: "most_wishlisted_upcoming",
};

export const IGDB_POPULARITY_TYPE_IDS: readonly number[] = Object.keys(IGDB_POPULARITY_TYPES).map(Number);

/** 只需要 query／queryAll（避免與 igdb.ts 互相 import）。 */
export interface IgdbQueryClient {
  query<T>(endpoint: string, body: string): Promise<T[]>;
  queryAll<T extends { id: number }>(endpoint: string, fields: string, where?: string): Promise<T[]>;
}

export interface IgdbPopularityPrimitive {
  id: number;
  game_id?: number;
  popularity_type?: number;
  value?: number;
  calculated_at?: number;
}

/** 原始列 → 我方型別；未知種類、缺 game_id 或 value 不是有限數字 → null。 */
export function toExternalHypeRecord(p: IgdbPopularityPrimitive): ExternalHypeRecord | null {
  const signal = p.popularity_type != null ? IGDB_POPULARITY_TYPES[p.popularity_type] : undefined;
  if (!signal || !p.game_id || typeof p.value !== "number" || !Number.isFinite(p.value)) return null;
  return { igdbGameId: p.game_id, signal, value: p.value };
}

/** 每種類 1 個請求：最新的 calculated_at（unix 秒 → ISO）。 */
export async function fetchIgdbHypeVersion(client: IgdbQueryClient): Promise<ExternalHypeVersion> {
  const out: ExternalHypeVersion = {};
  for (const typeId of IGDB_POPULARITY_TYPE_IDS) {
    const rows = await client.query<IgdbPopularityPrimitive>(
      "popularity_primitives",
      `fields calculated_at; where popularity_type = ${typeId}; sort calculated_at desc; limit 1;`,
    );
    const at = rows[0]?.calculated_at;
    out[IGDB_POPULARITY_TYPES[typeId]] = typeof at === "number" ? new Date(at * 1000).toISOString() : null;
  }
  return out;
}

/** 兩個種類的全部原始值（id 游標分頁，每頁 500；約 10.5 萬筆 ≈ 211 個請求，經 Provider 的節流）。 */
export async function fetchIgdbHypeRecords(client: IgdbQueryClient): Promise<ExternalHypeRecord[]> {
  const rows = await client.queryAll<IgdbPopularityPrimitive>(
    "popularity_primitives",
    "game_id,popularity_type,value",
    `popularity_type = (${IGDB_POPULARITY_TYPE_IDS.join(",")})`,
  );
  const out: ExternalHypeRecord[] = [];
  for (const r of rows) {
    const rec = toExternalHypeRecord(r);
    if (rec) out.push(rec);
  }
  return out;
}

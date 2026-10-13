/** 語言支援讀取（06 §語言支援區塊）：game_language_supports × languages → (代碼, 類型) 列。 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/kernel/db/client";
import { buildLanguageSupport, type GameLanguageSupport, type LanguageSupportType } from "../domain/entities";
import { withReadTimeout, type ReadOptions } from "./read-tx";

/** 在既有 transaction 內讀取一款遊戲的語言支援列（PK 以 game_id 開頭，走索引）。 */
export async function readLanguageSupportEntries(
  tx: DbOrTx,
  gameId: number,
): Promise<Array<{ languageCode: string; supportType: LanguageSupportType }>> {
  const res = await tx.execute<{ code: string; support_type: LanguageSupportType }>(sql`
    SELECT l.code, s.support_type
    FROM game_language_supports s JOIN languages l ON l.id = s.language_id
    WHERE s.game_id = ${gameId}
    ORDER BY l.code, s.support_type
  `);
  return res.rows.map((r) => ({ languageCode: r.code, supportType: r.support_type }));
}

/** 單獨讀取一款遊戲的語言支援區塊（詳情頁以外用；詳情頁在 getGameDetailBySlug 的同一個 transaction 讀）。 */
export async function getGameLanguageSupport(
  gameId: number,
  siteLocale: string,
  opts: ReadOptions = {},
): Promise<GameLanguageSupport> {
  const entries = await withReadTimeout((tx) => readLanguageSupportEntries(tx, gameId), opts);
  return buildLanguageSupport(entries, siteLocale);
}

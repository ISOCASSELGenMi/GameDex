/**
 * resolve_relations（04 §排程任務：每日＋回填每批後）：相似遊戲與活動關聯的批次解析（03 §相似遊戲）。
 * 回填每批只解析該批遊戲自己的清單，回填結束再跑一次全量（2026-10-13 使用者決定）。
 */
import { resolveEventGames, resolveSimilarGames, type RelationResolveStats } from "../../repository/relations";

type Log = (message: string, extra?: Record<string, unknown>) => void;

export interface ResolveRelationsResult {
  similar: RelationResolveStats;
  events: RelationResolveStats;
}

/** 全量解析。 */
export async function resolveRelations(ctx: { log: Log }): Promise<ResolveRelationsResult> {
  const similar = await resolveSimilarGames();
  const events = await resolveEventGames();
  const result = { similar, events };
  ctx.log("關聯解析完成", { ...result });
  return result;
}

/** 回填每批之後：只解析這批遊戲自己的相似清單。 */
export async function resolveBatchRelations(igdbIds: readonly number[]): Promise<RelationResolveStats> {
  return resolveSimilarGames({ igdbIds });
}

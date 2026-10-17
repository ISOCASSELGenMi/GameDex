/**
 * 資料匯出的 CSV 分段（09 §資料匯出）：從同一份 AccountExport 展開，不另外查詢（JSON 與 CSV 的內容不會分歧）。
 * 不使用壓縮套件：每一段一個檔（?format=csv&part=…）。純函式、零外部依賴。
 */
import { toCsv, type AccountExport, type ExportCsvPart } from "./account-self";

const joined = (v: readonly (string | number)[] | null | undefined): string | null => (v === null || v === undefined ? null : v.join(";"));

export function exportCsvPart(data: AccountExport, part: ExportCsvPart): string {
  switch (part) {
    case "profile": {
      const p = data.profile;
      const f = data.preferences;
      return toCsv(
        ["id", "display_name", "email", "email_is_placeholder", "email_verified", "handle", "avatar_url", "role", "created_at", "locale", "timezone", "preferred_region", "score_providers", "preferred_platform_ids", "default_list_visibility", "default_review_visibility"],
        [
          {
            id: p.id,
            display_name: p.displayName,
            email: p.email,
            email_is_placeholder: p.emailIsPlaceholder,
            email_verified: p.emailVerified,
            handle: p.handle,
            avatar_url: p.avatarUrl,
            role: p.role,
            created_at: p.createdAt,
            locale: f.locale,
            timezone: f.timezone,
            preferred_region: f.preferredRegion,
            score_providers: joined(f.scoreProviders),
            preferred_platform_ids: joined(f.preferredPlatformIds),
            default_list_visibility: f.defaultListVisibility,
            default_review_visibility: f.defaultReviewVisibility,
          },
        ],
      );
    }
    case "lists":
      return toCsv(
        ["id", "name", "description", "visibility", "sort_order", "game_count", "created_at", "updated_at"],
        data.lists.map((l) => ({ id: l.id, name: l.name, description: l.description, visibility: l.visibility, sort_order: l.sortOrder, game_count: l.games.length, created_at: l.createdAt, updated_at: l.updatedAt })),
      );
    case "list_games":
      return toCsv(
        ["list_id", "list_name", "game_id", "game_slug", "game_name", "position", "note", "added_at"],
        data.lists.flatMap((l) => l.games.map((g) => ({ list_id: l.id, list_name: l.name, game_id: g.gameId, game_slug: g.gameSlug, game_name: g.gameName, position: g.position, note: g.note, added_at: g.addedAt }))),
      );
    case "plays":
      return toCsv(
        ["id", "game_id", "game_slug", "game_name", "platform_id", "status", "started_on", "finished_on", "play_minutes", "rating", "review", "review_has_spoilers", "review_visibility", "private_note", "created_at", "updated_at"],
        data.playRecords.map((r) => ({
          id: r.id,
          game_id: r.gameId,
          game_slug: r.gameSlug,
          game_name: r.gameName,
          platform_id: r.platformId,
          status: r.status,
          started_on: r.startedOn,
          finished_on: r.finishedOn,
          play_minutes: r.playMinutes,
          rating: r.rating,
          review: r.review,
          review_has_spoilers: r.reviewHasSpoilers,
          review_visibility: r.reviewVisibility,
          private_note: r.privateNote,
          created_at: r.createdAt,
          updated_at: r.updatedAt,
        })),
      );
    case "follows":
      return toCsv(
        ["target_type", "target_id", "target_slug", "target_name", "followed_at"],
        data.follows.map((f) => ({ target_type: f.targetType, target_id: f.targetId, target_slug: f.targetSlug, target_name: f.targetName, followed_at: f.followedAt })),
      );
    case "owned_games":
      return toCsv(
        ["provider", "external_game_id", "external_title", "status", "matched_game_id", "matched_game_slug", "matched_game_name", "match_confidence_pct", "match_method", "imported_at"],
        data.ownedGames.map((o) => ({
          provider: o.provider,
          external_game_id: o.externalGameId,
          external_title: o.externalTitle,
          status: o.status,
          matched_game_id: o.matchedGameId,
          matched_game_slug: o.matchedGameSlug,
          matched_game_name: o.matchedGameName,
          match_confidence_pct: o.matchConfidencePct,
          match_method: o.matchMethod,
          imported_at: o.importedAt,
        })),
      );
  }
}

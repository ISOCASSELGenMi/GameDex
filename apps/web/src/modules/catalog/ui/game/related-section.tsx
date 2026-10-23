/**
 * 詳情頁「相關內容」區（參考 IGDB Related Content）：依關係分組（版本、擴充版、DLC、資料片、重製、移植、合輯…）的封面卡片橫列。
 * 伺服器元件；預設收合（`data-open="false"`，由 ExpandToggle 展開；`#related` 直接展開）。
 * 內容一律在 HTML 內（收合時 visibility:hidden，不進 Tab 順序與無障礙樹）。
 */
import Image from "next/image";
import type { ReactElement } from "react";
import { formatReleaseLabel, type Locale, type Translator } from "@sok/i18n";
import type { GameDetailExtra, GameSummary } from "../../domain/entities";
import { gameHref } from "../links";
import { gameNameLang } from "../name-lang";

export const RELATED_ID = "related";
export const RELATED_TITLE_ID = "related-title";

function RelatedCard({ game, locale }: { game: GameSummary; locale: Locale }): ReactElement {
  const label = formatReleaseLabel(game.firstReleaseDate, game.firstReleasePrecision ?? "tbd", locale);
  return (
    <a className="related-card" href={gameHref(locale, game.slug)}>
      {game.cover ? (
        <Image className="related-cover" src={game.cover.small} alt="" width={90} height={128} unoptimized />
      ) : (
        <span className="related-cover related-cover-empty" aria-hidden="true" />
      )}
      <span className="related-name" lang={gameNameLang(game.name, game.name === game.originalName, locale)}>
        {game.name}
      </span>
      <span className="related-meta">{label}</span>
    </a>
  );
}

export function RelatedSection({ extra, locale, t }: { extra: GameDetailExtra; locale: Locale; t: Translator }): ReactElement | null {
  if (extra.related.length === 0) return null;
  return (
    <div id={RELATED_ID} className="exp" data-open="false" data-related="">
      <div className="exp-inner">
        <section aria-labelledby={RELATED_TITLE_ID} className="detail-section">
          <h2 id={RELATED_TITLE_ID} tabIndex={-1} className="text-xl font-semibold">
            {t.t("ui.game.related.title")}
          </h2>
          {extra.related.map((group) => {
            const headingId = `related-group-${group.key}`;
            const groupName = t.t(`enums.relatedGroup.${group.key}`);
            const hidden = group.total - group.games.length;
            return (
              <section key={group.key} aria-labelledby={headingId} className="related-group" data-related-group={group.key}>
                <h3 id={headingId} className="font-semibold">
                  {t.t("ui.game.related.groupTitle", { group: groupName, count: group.total })}
                </h3>
                <ul className="related-grid">
                  {group.games.map((g) => (
                    <li key={g.gameId}>
                      <RelatedCard game={g} locale={locale} />
                    </li>
                  ))}
                </ul>
                {hidden > 0 ? (
                  <p className="text-sm text-[var(--muted)]" data-related-more="">
                    {t.t("ui.game.related.more", { count: hidden })}
                  </p>
                ) : null}
              </section>
            );
          })}
        </section>
      </div>
    </div>
  );
}

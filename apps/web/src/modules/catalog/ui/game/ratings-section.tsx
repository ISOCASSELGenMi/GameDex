/**
 * 詳情頁評分區（伺服器元件；05 §顯示規則、06）。
 * 輸出第 1 層（站長）允許的所有來源分數，預設只顯示 IGDB；互動與重算在 ratings-panel（客戶端）。
 * 評分區永遠渲染（使用者 2026-10-15 決定，取代 05 原本「沒有分數的遊戲不顯示分數區」）：沒有任何可顯示的分數時，
 * 顯示目前選用來源的欄位名稱、值空白（「—」，螢幕閱讀器讀「尚無評分」）；不寫 0 分、不退回沒選的來源。
 * JSON-LD 不受影響（沒分數就不輸出 aggregateRating）。
 */
import type { ReactElement } from "react";
import type { Locale, Translator } from "@sok/i18n";
import type { GameRating } from "../../domain/entities";
import type { RatingDisplayConfig } from "../../domain/rating-config";
import {
  KNOWN_RATING_PROVIDERS,
  defaultSelectedProviders,
  selectRatings,
  selectableProviders,
} from "../../domain/rating-display";
import { RatingsPanel, type RatingItem } from "./ratings-panel";

/** 來源／類型的顯示名稱。Metacritic 一律純文字「Metascore」（05：不用官方配色或 Logo）。 */
function sourceLabel(t: Translator, provider: string, scoreType: string): string {
  const specific = `ui.game.rating.label.${provider}.${scoreType}`;
  if (t.has(specific)) return t.t(specific);
  const generic = `ui.game.rating.provider.${provider}`;
  return t.has(generic) ? t.t(generic) : provider;
}

export function buildRatingItems(
  ratings: readonly GameRating[],
  config: RatingDisplayConfig,
  locale: Locale,
  t: Translator,
): (RatingItem & GameRating)[] {
  const nf = new Intl.NumberFormat(locale);
  // 全部（層 1 之後）依優先序排好；selected 不在伺服器套（由預設與客戶端偏好決定顯示哪些）
  const { shown } = selectRatings(ratings, { visible: config.visible, hiddenScoreTypes: config.hiddenScoreTypes, priority: config.priority });
  return shown.map((r) => {
    const source = sourceLabel(t, r.scoreProvider, r.scoreType);
    const score = nf.format(r.score);
    const max = nf.format(r.scoreMax);
    const text =
      r.reviewCount != null && r.reviewCount > 0
        ? t.t("ui.game.rating.line", {
            source,
            score,
            max,
            reviews: t.t(r.reviewCount === 1 ? "ui.game.rating.reviewsOne" : "ui.game.rating.reviewsOther", {
              count: r.reviewCount,
            }),
          })
        : t.t("ui.game.rating.lineNoCount", { source, score, max });
    return { ...r, text };
  });
}

export function RatingsSection({
  ratings,
  config,
  locale,
  t,
}: {
  ratings: readonly GameRating[];
  config: RatingDisplayConfig;
  locale: Locale;
  t: Translator;
}): ReactElement {
  const defaultSelected = defaultSelectedProviders(config.visible);
  const providerIds = selectableProviders(
    ratings.filter((r) => !config.hiddenScoreTypes.includes(r.scoreType)),
    config.visible,
    config.priority,
  );
  // 有欄位可顯示的來源：站長允許的（visible 為空＝已知的全部）；偏好與空白欄位都以此為準
  const fieldProviders = KNOWN_RATING_PROVIDERS.filter((id) => config.visible.length === 0 || config.visible.includes(id));

  const items = buildRatingItems(ratings, config, locale, t).map((r) => ({
    scoreProvider: r.scoreProvider,
    scoreType: r.scoreType,
    score: r.score,
    platformId: r.platformId,
    reviewCount: r.reviewCount,
    text: r.text,
  }));
  return (
    <section aria-labelledby="sec-ratings" className="detail-section" data-ratings-section>
      <h2 id="sec-ratings" className="text-xl font-semibold">
        {t.t("ui.game.sections.ratings")}
      </h2>
      <RatingsPanel
        items={items}
        visible={config.visible}
        priority={config.priority}
        defaultSelected={defaultSelected}
        providers={providerIds.map((id) => ({ id, label: t.t(`ui.game.rating.provider.${id}`) }))}
        fieldProviders={fieldProviders.map((id) => ({ id, label: t.t(`ui.game.rating.provider.${id}`) }))}
        labels={{
          legend: t.t("ui.game.rating.settings"),
          hint: t.t("ui.game.rating.settingsHint"),
          noRatings: t.t("ui.game.noRatings"),
        }}
      />
    </section>
  );
}

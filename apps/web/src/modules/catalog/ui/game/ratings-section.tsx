/**
 * 詳情頁評分區（伺服器元件；05 §顯示規則、06）。
 * 輸出第 1 層（站長）允許的所有來源分數，預設只顯示 IGDB；互動與重算在 ratings-panel（客戶端）。
 * 沒有任何可顯示的分數 → 不渲染整個區塊（不顯示「0 分」或空標題）。
 */
import type { ReactElement } from "react";
import type { Locale, Translator } from "@sok/i18n";
import type { GameRating } from "../../domain/entities";
import type { RatingDisplayConfig } from "../../domain/rating-config";
import {
  defaultSelectedProviders,
  selectRatings,
  selectableProviders,
  visibleRatings,
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
  const { shown } = selectRatings(ratings, { visible: config.visible, priority: config.priority });
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
}): ReactElement | null {
  if (visibleRatings(ratings, config.visible).length === 0) return null;
  const defaultSelected = defaultSelectedProviders(config.visible);
  const providerIds = selectableProviders(ratings, config.visible, config.priority);
  // 預設來源沒有分數、又沒有可切換的來源 → 使用者什麼都看不到也改不了：不顯示整區
  const defaults = selectRatings(ratings, { visible: config.visible, selected: defaultSelected, priority: config.priority });
  if (defaults.shown.length === 0 && providerIds.length < 2) return null;

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
        labels={{
          legend: t.t("ui.game.rating.settings"),
          hint: t.t("ui.game.rating.settingsHint"),
          none: t.t("ui.game.rating.none"),
        }}
      />
    </section>
  );
}

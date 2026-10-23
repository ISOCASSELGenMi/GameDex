/**
 * 詳情頁 About 區（參考 IGDB：公司、分類、系列、引擎、故事、各語言標題、其他稱呼）。伺服器元件。
 * 資訊格用 <dl>（桌機 4 欄、平板 2 欄、手機 1 欄）；空欄位整欄不顯示。
 */
import type { ReactElement, ReactNode } from "react";
import { translateLabel, type Locale, type Translator } from "@sok/i18n";
import type { GameDetail, GameFranchiseGroup } from "../../domain/entities";
import { genreLabel } from "../labels";
import { companyHref, franchiseHref } from "../links";
import { ExpandToggle } from "./expand-toggle";
import { companyColumns, enumTaxonomyLabel, localizedTitleRegionLabel, nonEmpty } from "./detail-view";

const LANG_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

function Item({ label, children, testId }: { label: string; children: ReactNode; testId: string }): ReactElement {
  return (
    <div className="about-item" data-about-item={testId}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function PlainList({ items }: { items: readonly ReactNode[] }): ReactElement {
  return (
    <ul className="about-list">
      {items.map((node, i) => (
        <li key={i}>{node}</li>
      ))}
    </ul>
  );
}

function franchiseLinks(groups: readonly GameFranchiseGroup[], kind: "franchise" | "collection", locale: Locale): ReactNode[] {
  return groups
    .filter((g) => g.kind === kind)
    .map((g) => (
      <a key={`${g.kind}:${g.slug}`} className="link" href={franchiseHref(locale, g.slug, g.kind)}>
        {g.name}
      </a>
    ));
}

export interface AboutSectionProps {
  game: GameDetail;
  /** 已去除重複的系列／合集（與下方「同系列作品」區塊一致）。 */
  franchises: readonly GameFranchiseGroup[];
  locale: Locale;
  t: Translator;
}

export function AboutSection({ game, franchises, locale, t }: AboutSectionProps): ReactElement {
  const { extra } = game;
  const cols = companyColumns(game.companies);
  const companyLink = (c: { slug: string; name: string }) => (
    <a className="link" href={companyHref(locale, c.slug)}>
      {c.name}
    </a>
  );
  const taxonomy = (items: readonly { slug: string; name: string }[], ns: "genres" | "themes") =>
    items.map((i) => (
      <span key={i.slug}>{translateLabel(t, ns, i.slug, i.name)}</span>
    ));
  const collections = franchiseLinks(franchises, "collection", locale);
  const franchiseItems = franchiseLinks(franchises, "franchise", locale);
  const hasGrid =
    cols.mainDevelopers.length > 0 ||
    cols.publishers.length > 0 ||
    cols.supporting.length > 0 ||
    game.genres.length > 0 ||
    game.themes.length > 0 ||
    nonEmpty(extra.gameModes) ||
    nonEmpty(extra.playerPerspectives) ||
    collections.length > 0 ||
    franchiseItems.length > 0 ||
    nonEmpty(extra.engines);
  const hasTitles = nonEmpty(extra.localizedTitles) || nonEmpty(extra.alternativeTitles);

  if (!hasGrid && !extra.storyline && !hasTitles) return <></>;

  return (
    <section aria-labelledby="sec-about" className="detail-section" data-about="">
      <h2 id="sec-about" className="text-xl font-semibold">
        {t.t("ui.game.about.title")}
      </h2>

      {hasGrid ? (
        <dl className="about-grid">
          {cols.mainDevelopers.length > 0 ? (
            <Item label={t.t("ui.game.about.mainDevelopers")} testId="main-developers">
              <PlainList items={cols.mainDevelopers.map((e) => companyLink(e.company))} />
            </Item>
          ) : null}
          {cols.publishers.length > 0 ? (
            <Item label={t.t("ui.game.about.publishers")} testId="publishers">
              <PlainList items={cols.publishers.map((e) => companyLink(e.company))} />
            </Item>
          ) : null}
          {cols.supporting.length > 0 ? (
            <Item label={t.t("ui.game.about.supportingDevelopers")} testId="supporting-developers">
              <PlainList
                items={cols.supporting.map((e) => (
                  <>
                    {companyLink(e.company)}
                    {e.porting ? <span className="about-tag">{t.t("ui.game.about.portingTag")}</span> : null}
                  </>
                ))}
              />
            </Item>
          ) : null}
          {game.genres.length > 0 ? (
            <Item label={t.t("ui.game.about.genres")} testId="genres">
              <PlainList items={game.genres.map((g) => genreLabel(t, g.slug, g.name))} />
            </Item>
          ) : null}
          {game.themes.length > 0 ? (
            <Item label={t.t("ui.game.about.themes")} testId="themes">
              <PlainList items={taxonomy(game.themes, "themes")} />
            </Item>
          ) : null}
          {nonEmpty(extra.gameModes) ? (
            <Item label={t.t("ui.game.about.gameModes")} testId="game-modes">
              <PlainList items={extra.gameModes.map((m) => enumTaxonomyLabel(t, "gameMode", m))} />
            </Item>
          ) : null}
          {nonEmpty(extra.playerPerspectives) ? (
            <Item label={t.t("ui.game.about.playerPerspectives")} testId="player-perspectives">
              <PlainList items={extra.playerPerspectives.map((m) => enumTaxonomyLabel(t, "playerPerspective", m))} />
            </Item>
          ) : null}
          {collections.length > 0 ? (
            <Item label={t.t("ui.game.about.collection")} testId="collection">
              <PlainList items={collections} />
            </Item>
          ) : null}
          {franchiseItems.length > 0 ? (
            <Item label={t.t("ui.game.about.franchise")} testId="franchise">
              <PlainList items={franchiseItems} />
            </Item>
          ) : null}
          {nonEmpty(extra.engines) ? (
            <Item label={t.t("ui.game.about.engines")} testId="engines">
              <PlainList items={extra.engines.map((e) => <span key={e.slug}>{e.name}</span>)} />
            </Item>
          ) : null}
        </dl>
      ) : null}

      {extra.storyline ? (
        <div className="about-story" data-about-story="">
          <h3 id="about-story-title" className="font-semibold">
            {t.t("ui.game.about.story")}
          </h3>
          <p className="text-sm text-[var(--muted)]">{t.t("ui.game.about.storyOriginal")}</p>
          <p id="about-story-text" lang="en" className="rm whitespace-pre-line" data-open="true">
            {extra.storyline}
          </p>
          <ExpandToggle targetId="about-story-text" kind="clamp" labelClosed={t.t("ui.common.showMore")} labelOpen={t.t("ui.common.showLess")} />
        </div>
      ) : null}

      {hasTitles ? (
        <div className="about-titles" data-about-titles="">
          {nonEmpty(extra.localizedTitles) ? (
            <div>
              <h3 id="about-localized-title" className="font-semibold">
                {t.t("ui.game.about.localizedTitles")}
              </h3>
              <dl className="about-title-list">
                {extra.localizedTitles.map((l) => (
                  <div key={l.localeCode}>
                    <dt>
                      {localizedTitleRegionLabel(t, locale, l.localeCode)}
                      {t.t("ui.common.colon")}
                    </dt>
                    <dd lang={LANG_TAG.test(l.localeCode) ? l.localeCode : undefined}>{l.name}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          {nonEmpty(extra.alternativeTitles) ? (
            <div>
              <h3 id="about-alt-title" className="font-semibold">
                {t.t("ui.game.about.alternativeTitles")}
              </h3>
              <dl className="about-title-list">
                {extra.alternativeTitles.map((a, i) => (
                  <div key={`${i}:${a.name}`}>
                    {a.comment ? (
                      <dt lang="en">
                        {a.comment}:
                      </dt>
                    ) : <dt className="sr-only">{t.t("ui.game.about.alternativeTitles")}</dt>}
                    <dd>{a.name}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * 平台／公司／系列頁共用的小元件：遊戲列表、分頁、logo。伺服器元件（無狀態）。
 */
import Image from "next/image";
import type { ReactElement, ReactNode } from "react";
import type { Locale, Translator } from "@sok/i18n";
import { formatReleaseLabel } from "@sok/i18n";
import type { GameListItem, ImageRef, PlatformGameItem } from "../../domain/entities";
import { StageIcon } from "../icons";
import { stageLabel } from "../labels";
import { gameHref } from "../links";
import { gameNameLang } from "../name-lang";
import { PageNav } from "../page-nav";
import { buildPager, gameDateText, gameStatusBadge } from "./view-model";

export function EntityLogo({ logo, name, small }: { logo: ImageRef | null; name: string; small?: boolean }): ReactElement | null {
  if (!logo) return null;
  const max = small ? { w: 64, h: 36 } : { w: 160, h: 90 };
  return (
    // 裝飾性：名稱已在標題。logo 是內縮不裁切的圖，限制最大尺寸
    <Image
      src={logo.medium}
      alt=""
      width={284}
      height={160}
      unoptimized={!logo.resized}
      style={{ width: "auto", height: "auto", maxWidth: max.w, maxHeight: max.h, objectFit: "contain", flex: "none" }}
      data-name={name}
    />
  );
}

export interface EntityGameListProps {
  items: readonly (GameListItem | PlatformGameItem)[];
  locale: Locale;
  t: Translator;
  /** 額外顯示在每筆的第三行（例如公司角色）。 */
  extra?: (item: GameListItem) => ReactNode;
}

function isPlatformItem(item: GameListItem | PlatformGameItem): item is PlatformGameItem {
  return "stage" in item && "date" in item;
}

/** 遊戲列表：封面縮圖、名稱、日期、狀態；每筆整列是一個連結。 */
export function EntityGameList({ items, locale, t, extra }: EntityGameListProps): ReactElement {
  return (
    <ul className="mt-3 grid list-none grid-cols-1 gap-2 p-0 md:grid-cols-2 xl:grid-cols-3" data-entity-games="">
      {items.map((it) => {
        const status = gameStatusBadge(t, it.gameStatus);
        const platformItem = isPlatformItem(it) ? it : null;
        const dateText = platformItem ? formatReleaseLabel(platformItem.date, platformItem.precision, locale) : gameDateText(it, locale);
        return (
          <li
            key={platformItem ? `${it.gameId}-${platformItem.stage}` : it.gameId}
            className="rounded-lg border border-[var(--border)] p-2"
            data-game={it.slug}
          >
            <a className="flex min-h-11 items-center gap-3" href={gameHref(locale, it.slug)}>
              {it.cover ? (
                <Image
                  className="summary-thumb"
                  src={it.cover.small}
                  alt=""
                  width={90}
                  height={128}
                  unoptimized={!it.cover.resized}
                  loading="lazy"
                  style={{ width: 45, height: 64, objectFit: "cover", flex: "none" }}
                />
              ) : (
                <span className="summary-thumb card-thumb-empty" aria-hidden="true" style={{ width: 45, height: 64, flex: "none" }} />
              )}
              <span className="flex min-w-0 flex-col gap-1">
                <span className="font-semibold [overflow-wrap:anywhere]" lang={gameNameLang(it.name, it.name === it.originalName, locale)}>
                  {it.name}
                </span>
                <span className="text-sm text-[var(--muted)]">
                  {platformItem ? (
                    <>
                      <StageIcon stage={platformItem.stage} /> {stageLabel(t, platformItem.stage)}
                      {t.t("ui.common.colon")}
                    </>
                  ) : null}
                  {dateText}
                </span>
                {status ? <span className="chip self-start">{status}</span> : null}
                {extra ? extra(it) : null}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export interface PagerProps {
  t: Translator;
  page: number;
  hasMore: boolean;
  hrefFor: (page: number) => string;
  /** 導覽區的 aria-label。 */
  label: string;
}

export function Pager({ t, page, hasMore, hrefFor, label }: PagerProps): ReactElement | null {
  const pager = buildPager(page, hasMore, hrefFor);
  if (!pager.prev && !pager.next) return null;
  return (
    <PageNav
      label={label}
      prevHref={pager.prev}
      nextHref={pager.next}
      prevText={t.t("ui.entities.prevPage")}
      nextText={t.t("ui.entities.nextPage")}
      pageText={t.t("ui.entities.page", { page })}
    />
  );
}

/** 篩選／切換用的連結列（aria-current 標示目前）。 */
export function LinkTabs({
  label,
  items,
}: {
  label: string;
  items: readonly { key: string; href: string; text: string; current: boolean }[];
}): ReactElement {
  return (
    <nav aria-label={label} className="mt-3">
      <ul className="flex flex-wrap gap-2">
        {items.map((it) => (
          <li key={it.key}>
            <a
              className="btn-secondary aria-[current=page]:font-bold aria-[current=page]:underline"
              href={it.href}
              aria-current={it.current ? "page" : undefined}
            >
              {it.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** 遊戲封面縮圖＋名稱連結（清單、遊玩紀錄、手動比對共用）。伺服器與客戶端元件都能用（沒有狀態）。 */
import Image from "next/image";
import type { ReactElement, ReactNode } from "react";
import type { GameMiniCard } from "@/modules/catalog";

export function GameThumb({ game, size = 45 }: { game: GameMiniCard | null; size?: number }): ReactElement {
  const height = Math.round((size * 128) / 90);
  if (game?.cover) {
    return (
      <Image
        src={game.cover.small}
        alt=""
        width={90}
        height={128}
        unoptimized={!game.cover.resized}
        loading="lazy"
        style={{ width: size, height, objectFit: "cover", flex: "none", borderRadius: 4 }}
      />
    );
  }
  return <span aria-hidden="true" className="inline-block rounded bg-[var(--surface-strong)]" style={{ width: size, height, flex: "none" }} />;
}

export function gamePageHref(locale: string, slug: string): string {
  return `/${locale}/games/${encodeURIComponent(slug)}`;
}

/** 一列遊戲：縮圖＋（名稱連結、副資訊）。名稱可換行，不撐出版面。 */
export function GameLine({ game, locale, meta, linkable = true }: { game: GameMiniCard; locale: string; meta?: ReactNode; linkable?: boolean }): ReactElement {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <GameThumb game={game} />
      <span className="flex min-w-0 flex-col">
        {linkable ? (
          <a className="link font-semibold [overflow-wrap:anywhere]" href={gamePageHref(locale, game.slug)}>
            {game.name}
          </a>
        ) : (
          <span className="font-semibold [overflow-wrap:anywhere]">{game.name}</span>
        )}
        {meta ? <span className="text-sm text-[var(--muted)]">{meta}</span> : null}
      </span>
    </span>
  );
}

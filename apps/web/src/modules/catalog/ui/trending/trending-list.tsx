"use client";
/**
 * 熱門榜的榜單（一頁 50 筆）。以客戶端元件吃緊湊的列（陣列，RSC payload 每筆約 150 bytes），伺服器端照樣 SSR 成 HTML。
 * 若在伺服器元件裡展開，每一筆的元素樹會同時出現在 HTML 與 RSC payload（06 §瀏覽與搜尋 的頁面大小預算；改版前整頁約 250 KB）。
 * 做法同 calendar/folded-cards.tsx。沒有 hooks／事件，沒有 JS 時是一般連結。
 */
import Image from "next/image";
import type { ReactElement } from "react";
import { HeatBadge } from "../heat-badge";

/** [slug, 詳情頁網址, 小封面（無則空字串）, 名稱, 名稱 lang（無則空字串）, 「上市日：…」整行文字, 熱度等級 0~5, 名次文字] */
export type TrendingRow = readonly [slug: string, href: string, cover: string, name: string, lang: string, dateText: string, heat: number, rank: string];

export function TrendingList({ rows, heatLabels, spriteId }: { rows: readonly TrendingRow[]; heatLabels: readonly (string | null)[]; spriteId: string }): ReactElement {
  return (
    <ol className="mt-4 grid list-none grid-cols-1 gap-2 p-0 md:grid-cols-2" role="list">
      {rows.map(([slug, href, cover, name, lang, dateText, heat, rank]) => (
        <li key={slug} className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-2" data-trending-item={slug}>
          <span className="w-14 shrink-0 text-center text-sm font-bold">{rank}</span>
          <a className="flex min-h-11 min-w-0 flex-1 items-center gap-3" href={href}>
            {cover ? (
              <Image className="summary-thumb" src={cover} alt="" width={90} height={128} unoptimized loading="lazy" style={{ width: 45, height: 64, objectFit: "cover", flex: "none" }} />
            ) : (
              <span className="summary-thumb card-thumb-empty" aria-hidden="true" style={{ width: 45, height: 64, flex: "none" }} />
            )}
            <span className="flex min-w-0 flex-col gap-1">
              <span className="font-semibold [overflow-wrap:anywhere]" lang={lang || undefined}>
                {name}
              </span>
              <span className="text-sm text-[var(--muted)]">{dateText}</span>
              <HeatBadge level={heat} label={heatLabels[Math.min(5, Math.max(0, Math.floor(heat)))] ?? null} className="self-start" spriteId={spriteId} />
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}

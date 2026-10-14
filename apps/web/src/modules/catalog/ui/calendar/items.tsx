/**
 * 月曆／議程清單裡的單一項目（伺服器元件）。
 * 沒有 JS 時遊戲卡片就是連到詳情頁的連結；有 JS 時 CalendarInteractive 攔截點擊改開預覽卡（data-card）。
 */
import Image from "next/image";
import type { ReactElement } from "react";
import type { Translator } from "@sok/i18n";
import { HeatBadge, heatBadgeLabel } from "../heat-badge";
import { EventIcon, StageIcon, StatusIcon, WarningIcon } from "../icons";
import { stageLabel, statusLabel } from "../labels";
import type { CardItem, DayItem, EventItem } from "./view-model";
import { platformChipText } from "./view-model";

const MAX_CHIPS = 3;

function Chips({ item }: { item: CardItem }): ReactElement | null {
  const platforms = item.card.platforms;
  if (platforms.length === 0) return null;
  const shown = platforms.slice(0, MAX_CHIPS);
  const rest = platforms.length - shown.length;
  return (
    <span className="chips">
      {shown.map((p) => (
        <span key={p.slug} className="chip">
          {platformChipText(p)}
        </span>
      ))}
      {rest > 0 ? <span className="chip">+{rest}</span> : null}
    </span>
  );
}

/** 完整卡片：小封面＋名稱＋平台 chip＋階段圖示與文字（＋延期／取消、資料來源待確認）。 */
export function FullCard({ item, href, t }: { item: CardItem; href: string; t: Translator }): ReactElement {
  const { card } = item;
  return (
    <a className="card" href={href} data-card={item.key}>
      {card.cover ? (
        <Image
          className="card-thumb"
          src={card.cover.small}
          alt=""
          width={90}
          height={128}
          unoptimized
          loading="lazy"
        />
      ) : (
        <span className="card-thumb card-thumb-empty" aria-hidden="true" />
      )}
      <span className="card-body">
        <span className="card-name">{card.name}</span>
        <Chips item={item} />
        <span className="card-meta">
          <HeatBadge level={card.heatLevel} label={heatBadgeLabel(t, card.heatLevel)} compact />
          <StageIcon stage={card.stage} />
          <span>{stageLabel(t, card.stage)}</span>
          {card.status === "delayed" || card.status === "cancelled" ? (
            <>
              <StatusIcon status={card.status} />
              <span>{statusLabel(t, card.status)}</span>
            </>
          ) : null}
        </span>
        {card.sourceStatus === "removed" ? (
          <span className="card-meta card-warn">
            <WarningIcon />
            <span>{t.t("ui.release.sourceUnconfirmed")}</span>
          </span>
        ) : null}
      </span>
    </a>
  );
}

/** 活動：圖示＋「活動」文字＋名稱＋時間（3a 沒有活動頁，不是連結）。 */
export function EventEntry({ item, t }: { item: EventItem; t: Translator }): ReactElement {
  return (
    <span className="ev" data-event={item.key}>
      <span className="ev-tag">
        <EventIcon />
        <span>{t.t("ui.calendar.event")}</span>
      </span>{" "}
      <span className="ev-name" lang="en">
        {item.event.name}
      </span>{" "}
      <span className="fc-p">
        {item.kindLabel} · {item.timeLabel}
      </span>
    </span>
  );
}

export function DayItemView({ item, hrefOf, t }: { item: DayItem; hrefOf: (item: CardItem) => string; t: Translator }): ReactElement {
  if (item.type === "event") return <EventEntry item={item} t={t} />;
  return <FullCard item={item} href={hrefOf(item)} t={t} />;
}

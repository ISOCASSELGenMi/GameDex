/**
 * ReleaseCard → 月曆畫面用的卡片資料。純函式（只依賴字典與 Intl）。
 * 預覽卡資料（buildPreview）與月曆格資料（toDayCard）都只在這裡建構：首屏的第一款與 day API 回傳的其餘款數用同一份，
 * 月曆「本月未定日」清單也用 buildPreview。
 */
import { formatReleaseLabel, type Locale, type Translator } from "@sok/i18n";
import type { ReleaseCard } from "../../domain/entities";
import { heatBadgeLabel } from "../heat-badge";
import { getTranslator, stageLabel, statusLabel } from "../labels";
import { gameHref } from "../links";
import { gameNameLang } from "../name-lang";
import type { CardTag, DayCardData, FoldRow, PreviewCardData } from "./types";

/** 列舉（平台、類型…）：分隔符號來自字典（zh-Hant「、」、en「, 」；Intl.ListFormat 的中文 unit 格式沒有分隔符號）。 */
export function joinList(locale: Locale, values: readonly string[]): string {
  return values.join(getTranslator(locale).t("ui.common.listSeparator"));
}

/** 卡片上的平台 chip 文字（有縮寫用縮寫）。 */
export function platformChipText(p: { abbreviation: string | null; name: string }): string {
  return p.abbreviation?.trim() || p.name;
}

/** 格內最多顯示幾個平台 chip、幾個標籤。 */
export const DAY_CARD_MAX_CHIPS = 3;
export const DAY_CARD_MAX_TAGS = 3;

export function buildPreview(card: ReleaseCard, locale: Locale, t: Translator): PreviewCardData {
  const preview: PreviewCardData = {
    h: gameHref(locale, card.slug),
    n: card.name,
    d: formatReleaseLabel(card.date, card.precision, locale),
    p: joinList(locale, card.platforms.map((p) => p.name)),
    sk: card.stage,
    s: stageLabel(t, card.stage),
  };
  if (card.originalName && card.originalName !== card.name) preview.o = card.originalName;
  if (card.cover) preview.c = card.cover.medium;
  if (card.status !== "scheduled") {
    preview.tk = card.status;
    preview.t = statusLabel(t, card.status);
  }
  if (card.sourceStatus === "removed") preview.r = 1;
  const heat = heatBadgeLabel(t, card.heatLevel);
  if (heat) {
    preview.hv = card.heatLevel;
    preview.hl = heat;
  }
  const abbr = card.platforms.map(platformChipText).join(" · ");
  if (abbr) preview.a = abbr;
  const notes: string[] = [];
  if (card.stage !== "full") notes.push(preview.s);
  if (card.status === "delayed" || card.status === "cancelled") notes.push(statusLabel(t, card.status));
  if (card.sourceStatus === "removed") notes.push(t.t("ui.release.sourceUnconfirmed"));
  if (notes.length > 0) preview.x = t.t("ui.common.parenthetical", { text: joinList(locale, notes) });
  return preview;
}

/** 折疊清單的一列（大量未定日）：[詳情頁網址, 名稱, 平台縮寫, 附註]。 */
export function toFoldRow(card: ReleaseCard, locale: Locale, t: Translator): FoldRow {
  const p = buildPreview(card, locale, t);
  return [p.h, p.n, p.a ?? "", p.x ?? ""];
}

/** 格內標籤：非正式版階段（Early Access…）、延期／取消、非本篇的遊戲類型（DLC…）、資料來源待確認。 */
export function cardTags(card: ReleaseCard, t: Translator): CardTag[] {
  const tags: CardTag[] = [];
  if (card.stage !== "full") tags.push({ k: "stage", i: card.stage, l: stageLabel(t, card.stage) });
  if (card.status === "delayed" || card.status === "cancelled") tags.push({ k: "status", i: card.status, l: statusLabel(t, card.status) });
  if (card.gameType && card.gameType !== "main_game") {
    const key = `enums.gameType.${card.gameType}`;
    if (t.has(key)) tags.push({ k: "type", l: t.t(key) });
  }
  if (card.sourceStatus === "removed") tags.push({ k: "warn", l: t.t("ui.release.sourceUnconfirmed") });
  return tags.slice(0, DAY_CARD_MAX_TAGS);
}

export function toDayCard(card: ReleaseCard, locale: Locale, t: Translator): DayCardData {
  const shown = card.platforms.slice(0, DAY_CARD_MAX_CHIPS);
  // 折疊清單專用的欄位（a、x）格內用不到，不送（整月 31 格的 HTML 大小）
  const { a: _abbr, x: _notes, ...preview } = buildPreview(card, locale, t);
  void _abbr;
  void _notes;
  const out: DayCardData = {
    ...preview,
    id: card.gameId,
    pc: shown.map(platformChipText),
    tg: cardTags(card, t),
  };
  const lang = gameNameLang(card.name, card.name === card.originalName, locale);
  if (lang) out.nl = lang;
  const rest = card.platforms.length - shown.length;
  if (rest > 0) out.pn = rest;
  return out;
}

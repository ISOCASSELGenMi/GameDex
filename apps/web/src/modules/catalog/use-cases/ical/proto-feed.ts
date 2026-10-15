/** 原型驗證用 feed：讀狀態檔 → ics（同一個產生函式）。檔案不存在 → null。 */
import type { Locale } from "@sok/i18n";
import { readProtoStateRaw } from "../../providers/ical-proto-store";
import type { IcalLinkBuilder } from "./generate";
import { parseProtoState, renderProtoFeed, type ProtoFeedName } from "./proto";

export async function renderStoredProtoFeed(
  feed: ProtoFeedName,
  opts: { locale: Locale; uidDomain: string; links: IcalLinkBuilder },
): Promise<string | null> {
  const raw = await readProtoStateRaw();
  if (raw === null) return null;
  return renderProtoFeed(parseProtoState(raw), feed, opts);
}

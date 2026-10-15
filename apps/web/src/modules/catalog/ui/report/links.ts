/** 回報入口網址（純函式）。目標以公開網址上有的識別碼指定：遊戲／平台／活動用 slug，上市事件用 id。 */
import type { Locale } from "@sok/i18n";
import type { ReportType } from "../../domain/entities";
import { localeHref } from "../links";

export type ReportLinkTarget =
  | { kind: "game"; slug: string }
  | { kind: "platform"; slug: string }
  | { kind: "event"; slug: string }
  | { kind: "release_event"; id: number };

export function reportHref(locale: Locale, target: ReportLinkTarget, type?: ReportType): string {
  const params = new URLSearchParams();
  if (target.kind === "release_event") params.set("releaseEvent", String(target.id));
  else params.set(target.kind, target.slug);
  if (type) params.set("type", type);
  return localeHref(locale, "/report", params.toString());
}

/** 查詢參數 → 目標；沒有或格式不對回 null。多個目標參數同時出現時依 releaseEvent → game → platform → event 取第一個。 */
export function parseReportTarget(params: Record<string, string | string[] | undefined>): ReportLinkTarget | null {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const releaseEvent = one("releaseEvent");
  if (releaseEvent !== undefined) return /^\d{1,9}$/.test(releaseEvent) ? { kind: "release_event", id: Number(releaseEvent) } : null;
  for (const kind of ["game", "platform", "event"] as const) {
    const slug = one(kind);
    if (slug !== undefined) return slug.length <= 255 ? { kind, slug } : null;
  }
  return null;
}

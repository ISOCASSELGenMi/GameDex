"use client";
/**
 * 平台、系列、公司、活動頁的追蹤人數（D83；同遊戲詳情頁的規則）：
 * 公開、與檢視者無關的 `GET /api/v1/follows/count/{type}/{id}`（CDN 可快取）。低於 FOLLOW_COUNT_MIN_DISPLAY 時 API 回 count=null → 不顯示；
 * accounts 停用時這個元件根本不會被掛上（slot 不存在）。數字用 Intl compact 格式。
 */
import { useEffect, useState, type ReactElement } from "react";
import type { FollowTarget } from "../domain/entities/follows";
import { getFollowCount } from "./follow-api";
import { str } from "./str";
import type { AccountStrings } from "./strings";

export function FollowCount({ strings, locale, targetType, targetId }: { strings: AccountStrings; locale: string; targetType: FollowTarget; targetId: number }): ReactElement | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await getFollowCount(targetType, targetId);
      if (alive && res.ok && res.data && typeof res.data.count === "number" && res.data.count > 0) setCount(res.data.count);
    })();
    return () => {
      alive = false;
    };
  }, [targetType, targetId]);
  if (count === null) return null;
  const text = str(strings, "follow.count", { count: new Intl.NumberFormat(locale, { notation: "compact" }).format(Math.floor(count)) });
  return (
    <p className="text-sm text-[var(--muted)]" data-follow-count={count}>
      {text}
    </p>
  );
}

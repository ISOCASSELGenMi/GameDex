"use client";
/**
 * 公開清單頁的擁有者提示（「這是你的清單」＋前往編輯）。只在客戶端取得：伺服器端 HTML 與檢視者無關。
 * 流程：先看 session（匿名就結束，不多打 API）→ 已登入才讀一筆清單看 isOwner。
 */
import { useEffect, useState, type ReactElement } from "react";
import { getSession } from "./auth-api";
import { getList, getSharedList } from "./data-api";
import { accountListHref } from "./links";
import { str } from "./str";
import type { AccountStrings } from "./strings";

export function ListOwnerHint({ strings, locale, listId, token }: { strings: AccountStrings; locale: string; listId: number; token: string | null }): ReactElement | null {
  const [owner, setOwner] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const s = await getSession();
      if (!alive || !(s.ok && s.data?.user)) return;
      const res = token ? await getSharedList(token, locale, 1) : await getList(listId, locale, 0, 1);
      if (alive && res.ok && res.data?.isOwner) setOwner(true);
    })();
    return () => {
      alive = false;
    };
  }, [listId, token, locale]);

  if (!owner) return null;
  return (
    <p className="notice" role="status" data-owner-hint="">
      {str(strings, "list.public.ownerHint")}{" "}
      <a className="link" href={accountListHref(locale, listId)}>
        {str(strings, "list.public.edit")}
      </a>
    </p>
  );
}

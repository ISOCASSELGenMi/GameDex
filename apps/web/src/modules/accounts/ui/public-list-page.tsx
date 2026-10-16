/**
 * 公開清單頁（09 §收藏清單）：`/[locale]/lists/[id]`（public）與 `/[locale]/lists/s/[token]`（unlisted，noindex）。
 * 伺服器端以「匿名檢視者」讀取（viewerId=null；不讀 Cookie／session），所以 HTML 與檢視者無關、不送 Set-Cookie。
 * 看不到（private、不存在、停權者的公開清單、token 錯誤）一律 notFound()。擁有者提示由客戶端元件另外取得。
 */
import { cache, type ReactElement } from "react";
import type { Locale } from "@sok/i18n";
import { LIST_GAMES_PAGE_DEFAULT } from "../domain/entities/lists";
import { readList, type ListDetailView } from "../use-cases/lists";
import { GameLine } from "./game-thumb";
import { ListOwnerHint } from "./list-owner-hint";
import { str } from "./str";
import { accountStrings } from "./strings";

export const PUBLIC_LIST_PAGE_SIZE = LIST_GAMES_PAGE_DEFAULT;

export type PublicListKey = { kind: "id"; id: number } | { kind: "token"; token: string };

/** 同一次請求內 generateMetadata 與頁面共用（React cache 以原始值引數去重）。 */
const readCached = cache(async (kind: "id" | "token", key: string, locale: string, page: number): Promise<ListDetailView | null> => {
  return readList({
    ...(kind === "id" ? { listId: Number(key) } : { shareToken: key }),
    viewerId: null,
    locale,
    limit: PUBLIC_LIST_PAGE_SIZE,
    offset: (Math.max(1, page) - 1) * PUBLIC_LIST_PAGE_SIZE,
  });
});

export function loadPublicList(key: PublicListKey, locale: Locale, page = 1): Promise<ListDetailView | null> {
  return key.kind === "id" ? readCached("id", String(key.id), locale, page) : readCached("token", key.token, locale, page);
}

export function publicListTitle(locale: Locale, detail: ListDetailView): string {
  return str(accountStrings(locale, ["list.public."]), "list.public.title", { name: detail.list.name, owner: detail.owner.displayName });
}

export function PublicListView({ locale, detail, page, pageHref, token }: { locale: Locale; detail: ListDetailView; page: number; pageHref: (page: number) => string; token: string | null }): ReactElement {
  const s = accountStrings(locale, ["list."]);
  const { list, owner, games } = detail;
  return (
    <article className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4 py-4" data-public-list={list.id}>
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold [overflow-wrap:anywhere]">{list.name}</h1>
        <p className="text-sm text-[var(--muted)]">
          {str(s, "list.public.by", { owner: owner.displayName })} ・ {str(s, "list.gameCount", { count: String(list.gameCount) })}
        </p>
        {list.description ? <p className="[overflow-wrap:anywhere]">{list.description}</p> : null}
        {token ? <p className="text-sm text-[var(--muted)]">{str(s, "list.public.unlistedNote")}</p> : null}
      </header>
      <ListOwnerHint strings={s} locale={locale} listId={list.id} token={token} />
      {games.length === 0 ? (
        <p className="text-[var(--muted)]">{str(s, "list.public.empty")}</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-3" aria-label={str(s, "list.gamesLabel")}>
          {games.map((g) => (
            <li key={g.gameId} className="flex min-w-0 flex-col gap-1 rounded-lg border border-[var(--border)] p-3" data-game-id={g.gameId}>
              {g.game ? <GameLine game={g.game} locale={locale} /> : null}
              {g.note ? <p className="text-sm [overflow-wrap:anywhere]">{g.note}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {page > 1 || detail.hasMore ? (
        <nav aria-label={str(s, "list.public.pager")} className="flex flex-wrap gap-4">
          {page > 1 ? (
            <a className="link inline-flex min-h-11 items-center" href={pageHref(page - 1)} rel="prev">
              {str(s, "list.public.prev")}
            </a>
          ) : null}
          {detail.hasMore ? (
            <a className="link inline-flex min-h-11 items-center" href={pageHref(page + 1)} rel="next">
              {str(s, "list.public.next")}
            </a>
          ) : null}
        </nav>
      ) : null}
    </article>
  );
}

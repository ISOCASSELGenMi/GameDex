/**
 * /internal/matches：Metacritic 比對覆核（12 §比對覆核）。伺服器元件；內部使用，介面文字固定 zh-Hant。
 * needs_review 佇列（信心由低到高）：確認 / 清除；並可手動輸入某遊戲的 Metacritic slug。純文字，不使用 Metacritic 的 Logo 或官方配色。
 */
import type { ReactElement } from "react";
import { AdminNav } from "@/kernel/ui/admin-nav";
import { loadReviewQueue, reviewGameUrl } from "../use-cases/review";

export interface MatchesAdminPageProps {
  searchParams: Record<string, string | string[] | undefined>;
  csrf: string;
}

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const FLASH: Record<string, string> = { confirm: "已確認配對（標為人工，排程不再覆寫）", reject: "已清除配對並加入否決清單，該遊戲的 Metacritic 分數一併刪除", manual: "已手動設定配對" };
const ERROR: Record<string, string> = { not_found: "找不到這筆配對或遊戲", invalid_slug: "slug 格式不合法（只能是小寫英數與連字號）" };

export async function MatchesAdminPage({ searchParams, csrf }: MatchesAdminPageProps): Promise<ReactElement> {
  const { items, total } = await loadReviewQueue(100);
  const done = one(searchParams.done);
  const error = one(searchParams.error);
  return (
    <main id="main" className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-bold">Metacritic 比對覆核</h1>
      <AdminNav current="matches" />
      {done && FLASH[done] ? (
        <p role="status" className="notice">
          {FLASH[done]}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="notice">
          {ERROR[error] ?? "處理失敗"}
        </p>
      ) : null}
      <section aria-labelledby="mq" className="flex flex-col gap-2">
        <h2 id="mq" className="text-xl font-semibold">
          待覆核（{total}）
        </h2>
        {items.length === 0 ? (
          <p data-matches="empty">沒有待覆核的配對。</p>
        ) : (
          <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="待覆核的配對">
            <table className="release-table" data-matches="table">
              <thead>
                <tr>
                  <th scope="col">遊戲</th>
                  <th scope="col">年份</th>
                  <th scope="col">候選 slug</th>
                  <th scope="col">信心</th>
                  <th scope="col">動作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id} data-match-id={m.id}>
                    <th scope="row" className="[overflow-wrap:anywhere]">
                      {m.gameName}（#{m.gameId}）
                    </th>
                    <td>{m.year ?? "—"}</td>
                    <td className="[overflow-wrap:anywhere]">
                      <a className="link" href={m.externalUrl ?? reviewGameUrl(m.externalId)} target="_blank" rel="noopener noreferrer">
                        {m.externalId}
                      </a>
                    </td>
                    <td>{m.confidencePct ?? "—"}</td>
                    <td>
                      <form method="post" action="/internal/matches/action" className="flex flex-wrap gap-2">
                        <input type="hidden" name="csrf" value={csrf} />
                        <input type="hidden" name="id" value={m.id} />
                        <button type="submit" name="action" value="confirm" className="btn-primary">
                          確認<span className="sr-only">　#{m.id}</span>
                        </button>
                        <button type="submit" name="action" value="reject" className="btn-secondary">
                          清除<span className="sr-only">　#{m.id}</span>
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section aria-labelledby="mm" className="flex flex-col gap-2">
        <h2 id="mm" className="text-xl font-semibold">
          手動輸入
        </h2>
        <form method="post" action="/internal/matches/action" className="flex flex-wrap items-end gap-2" data-matches="manual">
          <input type="hidden" name="csrf" value={csrf} />
          <input type="hidden" name="action" value="manual" />
          <label className="flex flex-col gap-1">
            <span className="font-semibold">遊戲 ID</span>
            <input name="gameId" inputMode="numeric" pattern="\d{1,9}" required className="min-h-8 text-sm w-40 rounded-md border border-[var(--border)] bg-[var(--background)] px-3" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Metacritic slug（網址 /game/ 後面那段）</span>
            <input name="slug" maxLength={200} required className="min-h-8 text-sm w-72 max-w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3" />
          </label>
          <button type="submit" className="btn-primary">
            設定
          </button>
        </form>
      </section>
    </main>
  );
}

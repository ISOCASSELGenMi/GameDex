/**
 * /internal/igdb-feedback：待回饋 IGDB 清單（12 §待回饋 IGDB 清單，D91）。伺服器元件、不用客戶端 JS；介面文字固定 zh-Hant。
 * 回報核可後自動產生的項目集中在這裡，管理者手動到 IGDB 網站提交修改，再回來標「已提交」；IGDB 同步偵測到已採納會自動標記。
 * 程式不呼叫任何 IGDB 寫入；只放 IGDB 遊戲頁連結。資料全部來自 catalog 的公開 API；寫入走 POST /internal/igdb-feedback/action。
 */
import type { ReactElement } from "react";
import { IGDB_FEEDBACK_STATUSES, listIgdbFeedback, type IgdbFeedbackListItem, type IgdbFeedbackStatus } from "@/modules/catalog";
import { AdminNav } from "@/kernel/ui/admin-nav";
import { createCsrfToken } from "../csrf";
import { Url } from "./reports-page";

const STATUS_LABEL: Record<IgdbFeedbackStatus, string> = { pending: "待回饋", submitted: "已提交", adopted: "已被 IGDB 採納", skipped: "略過" };
const FLASH_ACTION: Record<string, string> = { submit: "標為已提交", skip: "已略過", reopen: "已改回待回饋" };
const FLASH_ERROR: Record<string, string> = {
  no_selection: "請先勾選至少一筆項目",
  invalid_note: "處理備註太長",
};
const when = (d: Date | null) => (d ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : "—");

function Buttons({ item }: { item: IgdbFeedbackListItem }): ReactElement | null {
  if (item.status === "adopted") return null;
  const btn = (action: string, label: string, primary = false) => (
    <button type="submit" name="act" value={`${action}:${item.id}`} className={primary ? "btn-primary" : "btn-secondary"}>
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="font-semibold">處理備註（選填）</span>
        <textarea name={`note-${item.id}`} rows={2} maxLength={1000} defaultValue={item.handlerNote ?? ""} className="rounded-md border border-[var(--border)] bg-[var(--background)] p-2" />
      </label>
      <div className="flex flex-wrap gap-2">
        {item.status !== "submitted" ? btn("submit", "標為已提交", true) : null}
        {item.status !== "skipped" ? btn("skip", "略過") : null}
        {item.status !== "pending" ? btn("reopen", "改回待回饋") : null}
      </div>
    </div>
  );
}

function FeedbackCard({ item, publicLocale }: { item: IgdbFeedbackListItem; publicLocale: string }): ReactElement {
  const headingId = `feedback-${item.id}`;
  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-3 rounded-lg border border-[var(--border)] p-4" data-feedback-id={item.id}>
      <div className="flex flex-wrap items-center gap-3">
        {item.status !== "adopted" ? (
          <label className="inline-flex min-h-11 items-center gap-2">
            <input type="checkbox" name="ids" value={item.id} className="size-5" />
            <span>選取 #{item.id}</span>
          </label>
        ) : null}
        <h3 id={headingId} className="text-lg font-semibold">
          <a className="link" href={`/${publicLocale}/games/${encodeURIComponent(item.gameSlug)}`} target="_blank" rel="noopener noreferrer">
            {item.gameName}
          </a>
          <span className="chip ml-2">{item.fieldLabel}</span>
          <span className="chip ml-2">{STATUS_LABEL[item.status]}</span>
        </h3>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="font-semibold">IGDB 遊戲頁</dt>
        <dd>
          <a className="link break-all" href={item.igdbUrl} target="_blank" rel="noopener noreferrer">
            {item.igdbUrl}
          </a>
        </dd>
        <dt className="font-semibold">欄位位置</dt>
        <dd>{item.igdbLocation}</dd>
        {item.locationText ? (
          <>
            <dt className="font-semibold">平台／地區／階段</dt>
            <dd>{item.locationText}</dd>
          </>
        ) : null}
        <dt className="font-semibold">目前（IGDB）</dt>
        <dd>{item.oldText}</dd>
        <dt className="font-semibold">建議改為</dt>
        <dd className="font-semibold">{item.newText}</dd>
        <dt className="font-semibold">佐證連結</dt>
        <dd>
          <Url href={item.sourceUrl} />
        </dd>
        <dt className="font-semibold">回報者備註</dt>
        <dd className="whitespace-pre-wrap break-words">{item.reporterNote ?? "—"}</dd>
        <dt className="font-semibold">來源回報</dt>
        <dd>
          <a className="link" href={`/internal/reports?status=accepted#report-${item.reportId}`}>
            回報 #{item.reportId}
          </a>
          （建立於 {when(item.createdAt)}）
        </dd>
        {item.status !== "pending" ? (
          <>
            <dt className="font-semibold">狀態變更</dt>
            <dd>
              {STATUS_LABEL[item.status]}（{when(item.statusChangedAt)}）
              {item.status === "adopted" ? `，IGDB 採納於 ${when(item.adoptedAt)}` : ""}
            </dd>
            <dt className="font-semibold">處理備註</dt>
            <dd className="whitespace-pre-wrap break-words">{item.handlerNote ?? "—"}</dd>
          </>
        ) : null}
      </dl>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">可貼到 IGDB 的整理文字（唯讀，自行全選複製）</span>
        <textarea readOnly rows={Math.min(10, item.pasteText.split("\n").length + 1)} defaultValue={item.pasteText} className="rounded-md border border-[var(--border)] bg-[var(--background)] p-2 font-mono text-sm" />
      </label>
      <Buttons item={item} />
    </article>
  );
}

export interface IgdbFeedbackAdminPageProps {
  searchParams: Record<string, string | string[] | undefined>;
  publicLocale: string;
}

export async function IgdbFeedbackAdminPage({ searchParams, publicLocale }: IgdbFeedbackAdminPageProps): Promise<ReactElement> {
  const one = (k: string) => {
    const v = searchParams[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const rawStatus = one("status");
  const status = (IGDB_FEEDBACK_STATUSES as readonly string[]).includes(rawStatus ?? "") ? (rawStatus as IgdbFeedbackStatus) : "pending";
  const { items, counts } = await listIgdbFeedback({ status, limit: 50 });
  const csrf = createCsrfToken(process.env.ADMIN_BASIC_AUTH_PASS ?? "");

  const done = one("done");
  const error = one("error");
  const flash = done && FLASH_ACTION[done] ? `${FLASH_ACTION[done]}：${one("n") ?? "0"} 筆` : null;
  const batchable = status !== "adopted" && items.length > 0;

  return (
    <main id="main" className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-bold">待回饋 IGDB</h1>
      <AdminNav current="igdb-feedback" />
      <p className="text-sm text-[var(--muted)]">
        回報核可後產生的項目。請到 IGDB 遊戲頁手動提交修改（程式不會寫入 IGDB），提交後回來標「已提交」；IGDB 之後同步到相同內容會自動標為「已被 IGDB 採納」。
      </p>
      <nav aria-label="項目狀態">
        <ul className="flex flex-wrap gap-2">
          {IGDB_FEEDBACK_STATUSES.map((s) => (
            <li key={s}>
              <a
                className="link-quiet inline-flex min-h-11 items-center rounded-md px-2 aria-[current=page]:font-semibold aria-[current=page]:underline"
                href={s === "pending" ? "/internal/igdb-feedback" : `/internal/igdb-feedback?status=${s}`}
                aria-current={s === status ? "page" : undefined}
              >
                {STATUS_LABEL[s]}（{counts[s]}）
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {flash ? (
        <p role="status" className="notice">
          {flash}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="notice">
          {FLASH_ERROR[error] ?? "處理失敗"}
        </p>
      ) : null}
      {items.length === 0 ? <p>目前沒有{STATUS_LABEL[status]}的項目。</p> : null}
      <form method="post" action="/internal/igdb-feedback/action" className="flex flex-col gap-4">
        <input type="hidden" name="csrf" value={csrf} />
        <input type="hidden" name="status" value={status} />
        {batchable ? (
          <fieldset className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-3">
            <legend className="px-1 font-semibold">批次處理（先勾選下方項目）</legend>
            <label className="flex flex-col gap-1">
              <span className="font-semibold">批次處理備註（選填）</span>
              <textarea name="batchNote" rows={2} maxLength={1000} className="rounded-md border border-[var(--border)] bg-[var(--background)] p-2" />
            </label>
            <div className="flex flex-wrap gap-2">
              {status !== "submitted" ? (
                <button type="submit" name="act" value="submit:batch" className="btn-primary">
                  勾選的標為已提交
                </button>
              ) : null}
              {status !== "skipped" ? (
                <button type="submit" name="act" value="skip:batch" className="btn-secondary">
                  勾選的略過
                </button>
              ) : null}
              {status !== "pending" ? (
                <button type="submit" name="act" value="reopen:batch" className="btn-secondary">
                  勾選的改回待回饋
                </button>
              ) : null}
            </div>
          </fieldset>
        ) : null}
        <section aria-label="項目列表" className="flex flex-col gap-4">
          {items.map((item) => (
            <FeedbackCard key={item.id} item={item} publicLocale={publicLocale} />
          ))}
        </section>
      </form>
    </main>
  );
}

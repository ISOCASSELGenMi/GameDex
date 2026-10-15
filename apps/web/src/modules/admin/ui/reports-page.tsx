/**
 * /internal/reports：資料更正回報審核佇列（12 §回報審核）。伺服器元件；內部使用，介面文字固定 zh-Hant。
 * 每筆顯示：目前值 vs 提案值、來源連結、同目標其他回報，以及核可／駁回／標重複的表單（POST /internal/reports/{id}）。
 * 資料全部來自 catalog 的公開 API（listReportQueue）；寫入走 admin/api/reports.ts。
 */
import type { ReactElement } from "react";
import { createTranslator, formatReleaseLabel } from "@sok/i18n";
import { REPORT_STATUSES, listReportQueue, parseHttpUrl, type DataReport, type ReportQueueItem, type ReportStatus } from "@/modules/catalog";
import { createCsrfToken } from "../csrf";

const LOCALE = "zh-Hant" as const;
const t = createTranslator(LOCALE);

const STATUS_LABEL: Record<ReportStatus, string> = { open: "待處理", accepted: "已核可", rejected: "已駁回", duplicate: "重複" };
const FLASH_ACTION: Record<string, string> = { accept: "已核可", reject: "已駁回", duplicate: "已標為重複" };
const FLASH_ERROR: Record<string, string> = {
  not_found: "找不到這筆回報",
  already_resolved: "這筆回報已被處理過",
  invalid_note: "處理備註太長",
  cannot_apply: "無法套用：目標或提案值已不存在或不合法，請駁回或手動處理",
};

const typeLabel = (type: string) => t.t(`ui.report.type.${type}`);
const stageLabel = (s: string) => t.t(`enums.releaseStage.${s}`);
const statusLabel = (s: string) => (t.has(`enums.releaseStatus.${s}`) ? t.t(`enums.releaseStatus.${s}`) : s);
const regionLabel = (code: string) => (t.has(`enums.region.${code}`) ? `${code} ${t.t(`enums.region.${code}`)}` : code);
const when = (d: Date | null) => (d ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : "—");

function Url({ href }: { href: string | null }): ReactElement {
  const safe = href ? parseHttpUrl(href) : null;
  if (!safe) return <span className="text-[var(--muted)]">—</span>;
  return (
    <a className="link break-all" href={safe} target="_blank" rel="noopener noreferrer">
      {safe}
    </a>
  );
}

function CompareTable({ item }: { item: ReportQueueItem }): ReactElement | null {
  const { report, target, plan } = item;
  const p = report.proposed;
  const rows: Array<{ label: string; current: string; proposed: string }> = [];
  const dateText = (date: string | null, precision: string) => formatReleaseLabel(date, precision as never, LOCALE);

  if (report.reportType === "wrong_date" || report.reportType === "missing_region_date") {
    const cur = report.reportType === "wrong_date" ? target.currentReleases.find((r) => r.releaseEventId === report.targetId) : target.currentReleases[0];
    const manual = target.currentReleases.find((r) => r.source === "manual");
    rows.push({
      label: "平台／地區／階段",
      current: cur ? `${cur.platformName}／${regionLabel(cur.regionCode)}／${stageLabel(cur.stage)}` : "（無現有資料）",
      proposed: plan ? `${plan.platformName}／${regionLabel(plan.regionCode)}／${stageLabel(plan.stage)}` : "（無法計算）",
    });
    rows.push({
      label: "日期",
      current: cur ? dateText(cur.date, cur.precision) : "—",
      proposed: plan ? dateText(plan.releaseDate, plan.precision) : p?.date ? `${p.date}（${p.precision ?? "day"}）` : "—",
    });
    rows.push({
      label: "狀態",
      current: cur ? `${statusLabel(cur.status)}（來源 ${cur.source}，sequence ${cur.sequence}）` : "—",
      proposed: plan ? statusLabel(plan.status) : "—",
    });
    if (manual && manual !== cur) {
      rows.push({ label: "已有的 manual 列", current: `${dateText(manual.date, manual.precision)}（sequence ${manual.sequence}）`, proposed: "將被更新" });
    }
  } else if (report.reportType === "wrong_stage") {
    const cur = target.currentReleases.find((r) => r.releaseEventId === report.targetId);
    rows.push({ label: "階段", current: cur ? stageLabel(cur.stage) : "—", proposed: p?.stage ? stageLabel(p.stage) : "—" });
  } else if (report.reportType === "language_support") {
    rows.push({
      label: "語言支援",
      current: "（見遊戲詳情頁）",
      proposed: `${p?.language ?? "—"}／${p?.supportType ? t.t(`enums.languageSupportType.${p.supportType}`) : "—"}`,
    });
  }
  if (rows.length === 0) return null;
  return (
    <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label={`回報 #${report.id} 的目前值與提案值`}>
      <table className="release-table">
        <thead>
          <tr>
            <th scope="col">欄位</th>
            <th scope="col">目前值</th>
            <th scope="col">提案值</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>{r.current}</td>
              <td>{r.proposed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Others({ others }: { others: DataReport[] }): ReactElement | null {
  if (others.length === 0) return null;
  return (
    <div>
      <h4 className="font-semibold">同目標的其他回報（{others.length}）</h4>
      <ul className="ml-4 list-disc">
        {others.map((o) => (
          <li key={o.id}>
            #{o.id}：{typeLabel(o.reportType)}（{STATUS_LABEL[o.status]}，{when(o.createdAt)}）
            {o.proposed?.date ? `　提案 ${o.proposed.date}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReportCard({ item, csrf, publicLocale }: { item: ReportQueueItem; csrf: string; publicLocale: string }): ReactElement {
  const { report, target } = item;
  const headingId = `report-${report.id}`;
  const acceptHint =
    report.reportType === "wrong_date" || report.reportType === "missing_region_date"
      ? "核可會寫入 manual 上市列（含改期紀錄與 sequence）。"
      : "核可只改狀態並記錄備註，不會自動修改資料。";
  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-3 rounded-lg border border-[var(--border)] p-4">
      <h3 id={headingId} className="text-lg font-semibold">
        #{report.id}　{typeLabel(report.reportType)}
        <span className="chip ml-2">{STATUS_LABEL[report.status]}</span>
      </h3>
      <p className="text-sm text-[var(--muted)]">
        {when(report.createdAt)}・目標 {t.t(`ui.report.targetType.${report.targetType}`)}
        {report.targetId !== null ? ` #${report.targetId}` : ""}：
        {target.path ? (
          <a className="link" href={`/${publicLocale}${target.path}`} target="_blank" rel="noopener noreferrer">
            {target.name}
          </a>
        ) : (
          <span>{target.name ?? "（目標不存在或未指定）"}</span>
        )}
      </p>
      <CompareTable item={item} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="font-semibold">來源網址</dt>
        <dd>
          <Url href={report.sourceUrl} />
        </dd>
        <dt className="font-semibold">備註</dt>
        <dd className="whitespace-pre-wrap break-words">{report.note ?? "—"}</dd>
        {report.status !== "open" ? (
          <>
            <dt className="font-semibold">處理備註</dt>
            <dd className="whitespace-pre-wrap break-words">
              {report.resolutionNote ?? "—"}（{when(report.resolvedAt)}）
            </dd>
          </>
        ) : null}
      </dl>
      <Others others={item.others} />
      {report.status === "open" ? (
        <form method="post" action={`/internal/reports/${report.id}`} className="flex flex-col gap-2">
          <input type="hidden" name="csrf" value={csrf} />
          <label className="flex flex-col gap-1">
            <span className="font-semibold">處理備註（選填）</span>
            <textarea name="note" rows={2} maxLength={1000} className="rounded-md border border-[var(--border)] bg-[var(--background)] p-2" />
          </label>
          <p className="text-sm text-[var(--muted)]">{acceptHint}</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" name="action" value="accept" className="btn-primary">
              核可
            </button>
            <button type="submit" name="action" value="reject" className="btn-secondary">
              駁回
            </button>
            <button type="submit" name="action" value="duplicate" className="btn-secondary">
              標為重複
            </button>
          </div>
        </form>
      ) : null}
    </article>
  );
}

export interface ReportsAdminPageProps {
  searchParams: Record<string, string | string[] | undefined>;
  publicLocale: string;
}

export async function ReportsAdminPage({ searchParams, publicLocale }: ReportsAdminPageProps): Promise<ReactElement> {
  const one = (k: string) => {
    const v = searchParams[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const rawStatus = one("status");
  const status = (REPORT_STATUSES as readonly string[]).includes(rawStatus ?? "") ? (rawStatus as ReportStatus) : "open";
  const { items, counts } = await listReportQueue({ status, limit: 50 });
  const csrf = createCsrfToken(process.env.ADMIN_BASIC_AUTH_PASS ?? "");

  const done = one("done");
  const error = one("error");
  const flash = done && FLASH_ACTION[done] ? `#${one("id")} ${FLASH_ACTION[done]}${one("applied") ? `（manual 上市列：${one("applied")}）` : ""}` : null;

  return (
    <main id="main" className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-bold">資料更正回報</h1>
      <nav aria-label="回報狀態">
        <ul className="flex flex-wrap gap-2">
          {REPORT_STATUSES.map((s) => (
            <li key={s}>
              <a
                className="link-quiet inline-flex min-h-11 items-center rounded-md px-2 aria-[current=page]:font-semibold aria-[current=page]:underline"
                href={s === "open" ? "/internal/reports" : `/internal/reports?status=${s}`}
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
      {items.length === 0 ? <p>目前沒有{STATUS_LABEL[status]}的回報。</p> : null}
      <section aria-label="回報列表" className="flex flex-col gap-4">
        {items.map((item) => (
          <ReportCard key={item.report.id} item={item} csrf={csrf} publicLocale={publicLocale} />
        ))}
      </section>
    </main>
  );
}

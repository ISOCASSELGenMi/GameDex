/**
 * 篩選 UI（06 §篩選）。月曆、時間軸、熱門榜、瀏覽頁共用（伺服器元件）。
 * - <form method="get">（next/form：有 JS 時客戶端導覽、沒有 JS 時照常送出）＋原生 fieldset／checkbox／select／date
 *   送出的 query 不一定是正規形式（`?platform=a&platform=b&region=`），由 proxy 308 到正規網址。
 * - 已套用條件以可移除 chip（連結）顯示；空結果時列出條件並可逐一移除
 * - 面板外框：桌機 <details>、手機底部抽屜（FilterDrawer）
 */
import Form from "next/form";
import type { ReactElement, ReactNode } from "react";
import { FILTER_MAX_VALUES, countFilterValues, hasFilterValue, type FilterDimension, type FilterSpec } from "@sok/api-contract";
import type { Locale, Translator } from "@sok/i18n";
import type { FilterOptions } from "../../domain/entities";
import type { FilterNotice } from "../filter-mapping";
import { genreLabel, platformKindLabel, regionLabel, stageLabel } from "../labels";
import { joinList } from "../calendar/view-model";
import { FilterDrawer } from "./filter-drawer";
import { filterParamLabel, gameTypeLabel, minHeatLabel, releaseStateLabel, showKindLabel, themeLabel, type AppliedChip } from "./filter-labels";

/** 面板上可出現的欄位（依此順序渲染）。 */
export type FilterField =
  | "platform"
  | "platformKind"
  | "genre"
  | "theme"
  | "type"
  | "stage"
  | "status"
  | "region"
  | "dateRange"
  | "minHeat"
  | "show"
  | "rumored";

export const CALENDAR_FILTER_FIELDS: readonly FilterField[] = [
  "platform",
  "platformKind",
  "genre",
  "theme",
  "type",
  "stage",
  "status",
  "region",
  "minHeat",
  "rumored",
];
export const TIMELINE_FILTER_FIELDS: readonly FilterField[] = [
  "platform",
  "platformKind",
  "genre",
  "theme",
  "type",
  "stage",
  "status",
  "region",
  "dateRange",
  "minHeat",
  "rumored",
];
/** 時間軸（週）：沒有日期範圍（一週的範圍由 week／at 決定）。 */
export const WEEK_TIMELINE_FILTER_FIELDS: readonly FilterField[] = TIMELINE_FILTER_FIELDS.filter((f) => f !== "dateRange");
export const TRENDING_FILTER_FIELDS: readonly FilterField[] = ["platform", "platformKind", "genre"];

export function AppliedFilterChips({
  chips,
  t,
  clearHref,
  heading,
}: {
  chips: readonly AppliedChip[];
  t: Translator;
  clearHref: string;
  heading?: string;
}): ReactElement | null {
  if (chips.length === 0) return null;
  return (
    <div className="applied">
      <h2 className="text-sm font-semibold">{heading ?? t.t("filters.active")}</h2>
      <ul className="flex flex-wrap items-center gap-2">
        {chips.map((c) => {
          const text = t.t("filters.chipLabel", { dimension: filterParamLabel(t, c.param), label: c.label });
          return (
            <li key={`${c.param}:${c.value}`}>
              <a className="filter-chip" href={c.removeHref} aria-label={t.t("filters.remove", { label: text })}>
                {text}
                <span aria-hidden="true"> ✕</span>
              </a>
            </li>
          );
        })}
        <li>
          <a className="link inline-flex min-h-11 items-center px-2" href={clearHref}>
            {t.t("filters.clearAll")}
          </a>
        </li>
      </ul>
    </div>
  );
}

/** 空結果：列出造成空結果的條件（目前套用的全部條件），可逐一移除。沒有條件時只顯示 emptyText。 */
export function EmptyFilterResult({
  chips,
  t,
  clearHref,
  emptyText,
}: {
  chips: readonly AppliedChip[];
  t: Translator;
  clearHref: string;
  /** 沒有任何條件時的文字（「這個月沒有符合條件的遊戲」）。 */
  emptyText: string;
}): ReactElement {
  return (
    <div className="empty-result">
      <p className="font-semibold">{chips.length === 0 ? emptyText : t.t("filters.emptyResult")}</p>
      {chips.length > 0 ? <AppliedFilterChips chips={chips} t={t} clearHref={clearHref} heading={t.t("filters.emptyResultHint")} /> : null}
    </div>
  );
}

export function FilterNotices({ notices, t }: { notices: readonly FilterNotice[]; t: Translator }): ReactElement | null {
  if (notices.length === 0) return null;
  const ignored = notices
    .filter((n) => n.reason !== "tooMany" && n.value !== undefined)
    .map((n) => t.t("filters.chipLabel", { dimension: filterParamLabel(t, n.dimension), label: n.value ?? "" }));
  const tooMany = notices.filter((n) => n.reason === "tooMany");
  return (
    <div className="notice" role="note">
      {ignored.length > 0 ? <p>{t.t("filters.invalidValues", { values: joinList(t.locale, ignored) })}</p> : null}
      {tooMany.map((n) => (
        <p key={n.dimension}>{t.t("filters.tooManyValues", { dimension: filterParamLabel(t, n.dimension), max: String(FILTER_MAX_VALUES) })}</p>
      ))}
    </div>
  );
}

function Checkbox({
  name,
  value,
  label,
  checked,
}: {
  name: FilterDimension | "rumored";
  value: string;
  label: string;
  checked: boolean;
}): ReactElement {
  return (
    <label className="check">
      <input type="checkbox" name={name} value={value} defaultChecked={checked} />
      <span>{label}</span>
    </label>
  );
}

const HTML_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (v: string): string => v.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
/** 屬性值只含這些字元時不加引號（HTML5 允許；slug 都符合，少掉 payload 裡跳脫的 \"）。 */
const attr = (v: string): string => (/^[A-Za-z0-9_.:-]+$/.test(v) ? v : `"${escapeHtml(v)}"`);

/**
 * 核取方塊清單：整段做成一個 HTML 字串（一個 dangerouslySetInnerHTML）而不是幾百個 React 元素。
 * 伺服器元件的輸出會同時出現在 HTML 與 RSC payload（flight 資料）兩處，每個元素在 payload 裡要約 200 bytes 的陣列語法；
 * 字串只佔 HTML 本身的長度（平台約 210 個＋類型／主題等約 70 個，整頁省 40 KB 以上，06 §瀏覽與搜尋 的頁面大小預算）。
 * 內容全部經 escapeHtml／attr 處理；產生 `.check-grid > label > input[type=checkbox] ＋ 文字`（樣式與 <Checkbox> 的 label.check 相同，見 globals.css），沒有 JS 也能送出。
 */
function checkGridHtml(name: string, items: readonly { value: string; label: string; checked: boolean }[]): string {
  return items
    .map((it) => `<label><input type=checkbox name=${attr(name)} value=${attr(it.value)}${it.checked ? " checked" : ""}>${escapeHtml(it.label)}</label>`)
    .join("");
}

function CheckGrid({ name, items }: { name: string; items: readonly { value: string; label: string; checked: boolean }[] }): ReactElement {
  return <div className="check-grid" dangerouslySetInnerHTML={{ __html: checkGridHtml(name, items) }} />;
}

function CheckGroup({
  name,
  legend,
  items,
  spec,
  hint,
}: {
  name: FilterDimension;
  legend: string;
  items: readonly { value: string; label: string }[];
  spec: FilterSpec;
  hint?: string;
}): ReactElement | null {
  if (items.length === 0) return null;
  const hintId = hint ? `f-${name}-hint` : undefined;
  return (
    <fieldset aria-describedby={hintId}>
      <legend>{legend}</legend>
      {hint ? (
        <p id={hintId} className="fieldset-sub">
          {hint}
        </p>
      ) : null}
      <CheckGrid name={name} items={items.map((it) => ({ ...it, checked: hasFilterValue(spec, name, it.value as never) }))} />
    </fieldset>
  );
}

const selectClass = "min-h-11 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-[var(--foreground)]";

export interface FilterPanelProps {
  locale: Locale;
  t: Translator;
  options: FilterOptions;
  spec: FilterSpec;
  /** 表單送出的路徑（不含 query）。 */
  action: string;
  fields: readonly FilterField[];
  /** 送出時一併保留的非篩選參數（例如時間軸的 `at`、熱門榜的 `group`）。 */
  hidden?: Readonly<Record<string, string | undefined>>;
  /** 「全部清除」連結；預設＝action。 */
  clearHref?: string;
  /** 套用按鈕前的額外欄位（評分排名頁的排序、最低票數、年份）；欄位自己的 name 會一起送出。 */
  extraFields?: ReactNode;
  /**
   * 平台只列「常用」（已勾選的其他平台仍保留）。其他平台清單約 190 個核取方塊，伺服器元件的內容會同時出現在 HTML 與
   * 客戶端元件的 flight 資料裡（各約 100 KB）；評分排名頁用它把整頁 HTML 壓在 200 KB 內（平台類型與網址參數仍可篩任何平台）。
   */
  commonPlatformsOnly?: boolean;
}

export function FilterPanel({ locale, t, options, spec, action, fields, hidden, clearHref, extraFields, commonPlatformsOnly }: FilterPanelProps): ReactElement {
  const count = countFilterValues(spec);
  const summary = count > 0 ? t.t("filters.titleWithCount", { count }) : t.t("filters.title");
  const common = options.platforms.filter((p) => p.isCommon);
  const others = options.platforms.filter((p) => !p.isCommon && (!commonPlatformsOnly || hasFilterValue(spec, "platform", p.slug)));
  const othersChecked = others.some((p) => hasFilterValue(spec, "platform", p.slug));
  const list = (values: readonly string[], label: (v: string) => string) => joinList(locale, values.map(label));

  return (
    <FilterDrawer summary={summary} title={summary} closeLabel={t.t("ui.common.close")}>
      <Form action={action} prefetch={false} className="filter-form">
        {Object.entries(hidden ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        {fields.map((field) => {
          switch (field) {
            case "platform":
              return (
                <fieldset key={field}>
                  <legend>{filterParamLabel(t, "platform")}</legend>
                  {common.length > 0 ? (
                    <>
                      <p className="fieldset-sub">{t.t("filters.commonPlatforms")}</p>
                      <CheckGrid name="platform" items={common.map((p) => ({ value: p.slug, label: p.name, checked: hasFilterValue(spec, "platform", p.slug) }))} />
                    </>
                  ) : null}
                  {others.length > 0 ? (
                    <details className="more-platforms" open={othersChecked}>
                      <summary>{t.t("filters.morePlatforms")}</summary>
                      <CheckGrid name="platform" items={others.map((p) => ({ value: p.slug, label: p.name, checked: hasFilterValue(spec, "platform", p.slug) }))} />
                    </details>
                  ) : null}
                </fieldset>
              );
            case "platformKind":
              return (
                <CheckGroup
                  key={field}
                  name="platformKind"
                  legend={filterParamLabel(t, "platformKind")}
                  spec={spec}
                  items={options.platformKinds.map((k) => ({ value: k, label: platformKindLabel(t, k) }))}
                />
              );
            case "genre":
              return (
                <CheckGroup
                  key={field}
                  name="genre"
                  legend={filterParamLabel(t, "genre")}
                  spec={spec}
                  items={options.genres.map((g) => ({ value: g.slug, label: genreLabel(t, g.slug, g.name) }))}
                />
              );
            case "theme":
              return (
                <CheckGroup
                  key={field}
                  name="theme"
                  legend={filterParamLabel(t, "theme")}
                  spec={spec}
                  items={options.themes.map((g) => ({ value: g.slug, label: themeLabel(t, g.slug, g.name) }))}
                />
              );
            case "type":
              return (
                <CheckGroup
                  key={field}
                  name="type"
                  legend={filterParamLabel(t, "type")}
                  spec={spec}
                  hint={t.t("filters.defaultHint", { values: list(options.defaultGameTypes, (v) => gameTypeLabel(t, v)) })}
                  items={options.gameTypes.map((v) => ({ value: v, label: gameTypeLabel(t, v) }))}
                />
              );
            case "stage":
              return (
                <CheckGroup
                  key={field}
                  name="stage"
                  legend={filterParamLabel(t, "stage")}
                  spec={spec}
                  hint={t.t("filters.defaultStagesHint", { stages: list(options.defaultStages, (v) => stageLabel(t, v)) })}
                  items={options.stages.map((s) => ({ value: s, label: stageLabel(t, s) }))}
                />
              );
            case "status":
              return (
                <CheckGroup
                  key={field}
                  name="status"
                  legend={filterParamLabel(t, "status")}
                  spec={spec}
                  items={options.releaseStates.map((s) => ({ value: s, label: releaseStateLabel(t, s) }))}
                />
              );
            case "show":
              return (
                <CheckGroup
                  key={field}
                  name="show"
                  legend={filterParamLabel(t, "show")}
                  spec={spec}
                  hint={t.t("filters.showHint")}
                  items={(["releases", "events"] as const).map((s) => ({ value: s, label: showKindLabel(t, s) }))}
                />
              );
            case "region":
              return (
                <div key={field} className="flex flex-col gap-1">
                  <label htmlFor="f-region" className="font-bold">
                    {filterParamLabel(t, "region")}
                  </label>
                  <p id="f-region-hint" className="fieldset-sub">
                    {t.t("filters.regionHint")}
                  </p>
                  <select id="f-region" name="region" defaultValue={spec.region ?? ""} aria-describedby="f-region-hint" className={`${selectClass} max-w-xs`}>
                    <option value="">{t.t("filters.regionDefault", { region: regionLabel(t, "WW") })}</option>
                    {options.regions.map((r) => (
                      <option key={r} value={r}>
                        {regionLabel(t, r)}
                      </option>
                    ))}
                  </select>
                </div>
              );
            case "minHeat":
              return (
                <div key={field} className="flex flex-col gap-1">
                  <label htmlFor="f-minheat" className="font-bold">
                    {filterParamLabel(t, "minHeat")}
                  </label>
                  <select id="f-minheat" name="minHeat" defaultValue={spec.minHeat !== undefined ? String(spec.minHeat) : ""} className={`${selectClass} max-w-xs`}>
                    <option value="">{t.t("filters.any")}</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={String(n)}>
                        {minHeatLabel(t, n)}
                      </option>
                    ))}
                  </select>
                </div>
              );
            case "dateRange":
              return (
                <fieldset key={field} aria-describedby="f-range-hint">
                  <legend>{t.t("filters.dateRange")}</legend>
                  <p id="f-range-hint" className="fieldset-sub">
                    {t.t("filters.dateRangeHint")}
                  </p>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex flex-col gap-1">
                      <span>{filterParamLabel(t, "from")}</span>
                      <input type="date" name="from" defaultValue={spec.from ?? ""} className={selectClass} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span>{filterParamLabel(t, "to")}</span>
                      <input type="date" name="to" defaultValue={spec.to ?? ""} className={selectClass} />
                    </label>
                  </div>
                </fieldset>
              );
            case "rumored":
              return (
                <fieldset key={field}>
                  <legend>{filterParamLabel(t, "rumored")}</legend>
                  <Checkbox name="rumored" value="1" label={t.t("filters.rumoredOption")} checked={spec.rumored === true} />
                </fieldset>
              );
            default:
              return null;
          }
        })}
        {extraFields}
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="btn-primary">
            {t.t("filters.apply")}
          </button>
          <a className="btn-secondary" href={clearHref ?? action}>
            {t.t("filters.clearAll")}
          </a>
        </div>
      </Form>
    </FilterDrawer>
  );
}

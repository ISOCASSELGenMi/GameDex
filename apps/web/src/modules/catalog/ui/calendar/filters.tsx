/**
 * 篩選 UI（06 §篩選；3a 維度：平台、平台類型、類型、階段）。
 * - <form method="get">（next/form：有 JS 時客戶端導覽、沒有 JS 時照常送出）＋原生 fieldset／checkbox
 * - 已套用條件以可移除 chip（連結）顯示；空結果時列出條件並可逐一移除
 * - 「篩選（n）」面板用 <details>（手機即抽屜）
 */
import Form from "next/form";
import type { ReactElement } from "react";
import {
  FILTER_DIMENSIONS,
  FILTER_MAX_VALUES,
  countFilterValues,
  filterSpecToQueryString,
  hasFilterValue,
  removeFilterValue,
  type FilterDimension,
  type FilterSpec,
} from "@sok/api-contract";
import type { Locale, Translator } from "@sok/i18n";
import type { FilterOptions } from "../../domain/entities";
import type { FilterNotice } from "../filter-mapping";
import { genreLabel, platformKindLabel, stageLabel } from "../labels";
import { withQuery } from "../links";
import { joinList } from "./view-model";

export interface FilterLabeler {
  (dimension: FilterDimension, value: string): string;
}

export function makeFilterLabeler(t: Translator, options: FilterOptions): FilterLabeler {
  const platformNames = new Map(options.platforms.map((p) => [p.slug, p.name]));
  const genreNames = new Map(options.genres.map((g) => [g.slug, g.name]));
  return (dimension, value) => {
    switch (dimension) {
      case "platform":
        return platformNames.get(value) ?? value;
      case "platformKind":
        return platformKindLabel(t, value);
      case "genre":
        return genreLabel(t, value, genreNames.get(value));
      case "stage":
        return stageLabel(t, value);
      default:
        // 3b 新維度（theme、type、status…）的標籤由 UI 波次補上；先顯示原值（G 的最小相容修正）
        return value;
    }
  };
}

interface AppliedChip {
  dimension: FilterDimension;
  value: string;
  label: string;
  removeHref: string;
}

export function appliedChips(spec: FilterSpec, basePath: string, label: FilterLabeler): AppliedChip[] {
  const out: AppliedChip[] = [];
  for (const dim of FILTER_DIMENSIONS) {
    const values = (spec[dim] ?? []) as readonly string[];
    for (const value of values) {
      const next = removeFilterValue(spec, dim, value as never);
      out.push({ dimension: dim, value, label: label(dim, value), removeHref: withQuery(basePath, filterSpecToQueryString(next)) });
    }
  }
  return out;
}

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
      <h2 className="text-sm font-semibold" id={heading ? undefined : "applied-title"}>
        {heading ?? t.t("filters.active")}
      </h2>
      <ul className="flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <li key={`${c.dimension}:${c.value}`}>
            <a className="filter-chip" href={c.removeHref} aria-label={t.t("filters.remove", { label: c.label })}>
              {t.t("filters.chipLabel", { dimension: t.t(`filters.dimensions.${c.dimension}`), label: c.label })}
              <span aria-hidden="true"> ✕</span>
            </a>
          </li>
        ))}
        <li>
          <a className="link inline-flex min-h-11 items-center px-2" href={clearHref}>
            {t.t("filters.clearAll")}
          </a>
        </li>
      </ul>
    </div>
  );
}

export function FilterNotices({
  notices,
  t,
}: {
  notices: readonly FilterNotice[];
  t: Translator;
}): ReactElement | null {
  if (notices.length === 0) return null;
  const ignored = notices
    .filter((n) => n.reason !== "tooMany" && n.value !== undefined)
    .map((n) => t.t("filters.chipLabel", { dimension: t.t(`filters.dimensions.${n.dimension}`), label: n.value ?? "" }));
  const tooMany = notices.filter((n) => n.reason === "tooMany");
  return (
    <div className="notice" role="note">
      {ignored.length > 0 ? <p>{t.t("filters.invalidValues", { values: joinList(t.locale, ignored) })}</p> : null}
      {tooMany.map((n) => (
        <p key={n.dimension}>{t.t("filters.tooManyValues", { dimension: t.t(`filters.dimensions.${n.dimension}`), max: String(FILTER_MAX_VALUES) })}</p>
      ))}
    </div>
  );
}

function Checkbox({
  name,
  value,
  label,
  checked,
  lang,
}: {
  name: FilterDimension;
  value: string;
  label: string;
  checked: boolean;
  lang?: string;
}): ReactElement {
  return (
    <label className="check">
      <input type="checkbox" name={name} value={value} defaultChecked={checked} />
      <span lang={lang}>{label}</span>
    </label>
  );
}

export function FilterPanel({
  locale,
  t,
  options,
  spec,
  action,
}: {
  locale: Locale;
  t: Translator;
  options: FilterOptions;
  spec: FilterSpec;
  action: string;
}): ReactElement {
  const count = countFilterValues(spec);
  const common = options.platforms.filter((p) => p.isCommon);
  const others = options.platforms.filter((p) => !p.isCommon);
  const othersChecked = others.some((p) => hasFilterValue(spec, "platform", p.slug));
  const defaultStages = joinList(
    locale,
    options.defaultStages.map((s) => stageLabel(t, s)),
  );
  return (
    <details className="filter-panel">
      <summary className="filter-summary">{count > 0 ? t.t("filters.titleWithCount", { count }) : t.t("filters.title")}</summary>
      <Form action={action} prefetch={false} className="filter-form">
        <fieldset>
          <legend>{t.t("filters.dimensions.platform")}</legend>
          <p className="fieldset-sub">{t.t("filters.commonPlatforms")}</p>
          <div className="check-grid">
            {common.map((p) => (
              <Checkbox key={p.slug} name="platform" value={p.slug} label={p.name} checked={hasFilterValue(spec, "platform", p.slug)} />
            ))}
          </div>
          {others.length > 0 ? (
            <details className="more-platforms" open={othersChecked}>
              <summary>{t.t("filters.morePlatforms")}</summary>
              <div className="check-grid">
                {others.map((p) => (
                  <Checkbox key={p.slug} name="platform" value={p.slug} label={p.name} checked={hasFilterValue(spec, "platform", p.slug)} />
                ))}
              </div>
            </details>
          ) : null}
        </fieldset>
        <fieldset>
          <legend>{t.t("filters.dimensions.platformKind")}</legend>
          <div className="check-grid">
            {options.platformKinds.map((k) => (
              <Checkbox key={k} name="platformKind" value={k} label={platformKindLabel(t, k)} checked={hasFilterValue(spec, "platformKind", k)} />
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>{t.t("filters.dimensions.genre")}</legend>
          <div className="check-grid">
            {options.genres.map((g) => (
              <Checkbox key={g.slug} name="genre" value={g.slug} label={genreLabel(t, g.slug, g.name)} checked={hasFilterValue(spec, "genre", g.slug)} />
            ))}
          </div>
        </fieldset>
        <fieldset aria-describedby="stage-hint">
          <legend>{t.t("filters.dimensions.stage")}</legend>
          <p id="stage-hint" className="fieldset-sub">
            {t.t("filters.defaultStagesHint", { stages: defaultStages })}
          </p>
          <div className="check-grid">
            {options.stages.map((s) => (
              <Checkbox key={s} name="stage" value={s} label={stageLabel(t, s)} checked={hasFilterValue(spec, "stage", s as never)} />
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="btn-primary">
            {t.t("filters.apply")}
          </button>
          <a className="btn-secondary" href={action}>
            {t.t("filters.clearAll")}
          </a>
        </div>
      </Form>
    </details>
  );
}

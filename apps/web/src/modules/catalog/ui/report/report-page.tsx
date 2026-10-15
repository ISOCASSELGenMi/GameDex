/**
 * 回報表單頁 `/[locale]/report`（12 §入口）。目標由查詢參數帶入（見 links.ts），伺服器驗證目標存在，找不到 → 404。
 * 動態頁（讀 searchParams 與 DB），不送 Set-Cookie；noindex。
 */
import { notFound } from "next/navigation";
import type { ReactElement } from "react";
import { formatReleaseLabel, type Locale } from "@sok/i18n";
import { DATE_PRECISIONS, LANGUAGE_SUPPORT_TYPES, RELEASE_STAGES, REPORT_TYPES, type ReportType } from "../../domain/entities";
import { REPORT_NOTE_MAX } from "../../domain/report-validation";
import { getReportFormContext, type ReportFormContext } from "../../use-cases/reports";
import { getTranslator, regionLabel, stageLabel } from "../labels";
import { localeHref } from "../links";
import { PageShell } from "../layout/page-shell";
import { parseReportTarget } from "./links";
import { ReportForm, type ReportFormStrings } from "./report-form";

type SearchParams = Record<string, string | string[] | undefined>;

const CAPTCHA_LANGUAGE: Record<Locale, string> = { "zh-Hant": "zh-tw", en: "en", ja: "ja" };

export async function loadReportContext(searchParams: SearchParams): Promise<{ ctx: ReportFormContext; type: ReportType } | null> {
  const target = parseReportTarget(searchParams);
  if (!target) return null;
  const ctx = await getReportFormContext(target);
  if (!ctx) return null;
  const raw = Array.isArray(searchParams.type) ? searchParams.type[0] : searchParams.type;
  const requested = (REPORT_TYPES as readonly string[]).includes(raw ?? "") ? (raw as ReportType) : null;
  const type = requested && ctx.reportTypes.includes(requested) ? requested : (ctx.reportTypes[0] ?? "other");
  return { ctx, type };
}

export function reportTitle(locale: Locale): string {
  return getTranslator(locale).t("ui.report.title");
}

export async function ReportPage({
  locale,
  supportedLocales,
  searchParams,
}: {
  locale: Locale;
  supportedLocales: readonly Locale[];
  searchParams: SearchParams;
}): Promise<ReactElement> {
  const loaded = await loadReportContext(searchParams);
  if (!loaded) notFound();
  const { ctx, type } = loaded;
  const t = getTranslator(locale);
  const r = (key: string, values?: Record<string, string | number>) => t.t(`ui.report.${key}`, values);

  const strings: ReportFormStrings = {
    fieldType: r("field.type"),
    fieldPlatform: r("field.platform"),
    fieldRegion: r("field.region"),
    fieldDate: r("field.date"),
    fieldPrecision: r("field.precision"),
    fieldStage: r("field.stage"),
    fieldLanguage: r("field.language"),
    fieldSupportType: r("field.supportType"),
    fieldSourceUrl: r("field.sourceUrl"),
    fieldNote: r("field.note"),
    fieldCaptcha: r("field.captcha"),
    hintSourceUrl: r("hint.sourceUrl"),
    hintSourceUrlRequired: r("hint.sourceUrlRequired"),
    hintDate: r("hint.date"),
    hintTakedown: r("hint.takedown"),
    hintNote: r("hint.note", { max: REPORT_NOTE_MAX }),
    choose: r("hint.choose"),
    submit: r("submit"),
    submitting: r("submitting"),
    successTitle: r("success.title"),
    successBody: r("success.body"),
    backTo: r("success.backTo", { name: ctx.name }),
    errorSummary: r("errors.summary"),
    errorRequired: r("errors.required"),
    errorInvalid: r("errors.invalid"),
    errorTooLong: r("errors.tooLong"),
    errorRateLimited: r("errors.rateLimited"),
    errorCaptchaFailed: r("errors.captchaFailed"),
    errorCaptchaMissing: r("errors.captchaMissing"),
    errorUnavailable: r("errors.unavailable"),
    errorNetwork: r("errors.network"),
    errorGeneric: r("errors.generic"),
    captchaLoading: r("captchaLoading"),
    currentValue: ctx.releaseEvent
      ? r("hint.currentValue", {
          value: `${ctx.releaseEvent.platformName}／${regionLabel(t, ctx.releaseEvent.regionCode)}／${stageLabel(t, ctx.releaseEvent.stage)}／${formatReleaseLabel(ctx.releaseEvent.date, ctx.releaseEvent.precision, locale)}`,
        })
      : null,
  };

  const languageName = (l: { code: string; name: string; nativeName: string | null }) =>
    l.nativeName && l.nativeName !== l.name ? `${l.name}（${l.nativeName}）` : l.name;
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim() || null;

  return (
    <PageShell locale={locale} supportedLocales={supportedLocales} path="/report" query={new URLSearchParams(flatten(searchParams)).toString()}>
      <article className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold">{r("title")}</h1>
        <p>{r("intro")}</p>
        <p className="notice max-w-xl">{r("privacy")}</p>
        <p>
          <span className="font-semibold">
            {r("target")}
            {t.t("ui.common.colon")}
          </span>
          <a className="link" href={localeHref(locale, ctx.path)} lang="en">
            {ctx.name}
          </a>
          <span className="text-[var(--muted)]">
            {" "}
            {t.t("ui.common.parenthetical", { text: r(`targetType.${ctx.targetType}`) })}
          </span>
        </p>
        <ReportForm
          strings={strings}
          targetType={ctx.targetType}
          targetId={ctx.targetId}
          backHref={localeHref(locale, ctx.path)}
          initialType={type}
          reportTypes={ctx.reportTypes.map((v) => ({ value: v, label: r(`type.${v}`) }))}
          platforms={ctx.platforms.map((p) => ({ value: String(p.id), label: p.name }))}
          regions={ctx.regions.map((x) => ({ value: x.code, label: regionLabel(t, x.code) }))}
          precisions={DATE_PRECISIONS.map((v) => ({ value: v, label: t.t(`enums.datePrecision.${v}`) }))}
          stages={RELEASE_STAGES.map((v) => ({ value: v, label: stageLabel(t, v) }))}
          languages={ctx.languages.map((l) => ({ value: l.code, label: languageName(l) }))}
          supportTypes={LANGUAGE_SUPPORT_TYPES.map((v) => ({ value: v, label: t.t(`enums.languageSupportType.${v}`) }))}
          noteMax={REPORT_NOTE_MAX}
          siteKey={siteKey}
          captchaLanguage={CAPTCHA_LANGUAGE[locale] ?? "auto"}
        />
      </article>
    </PageShell>
  );
}

function flatten(params: SearchParams): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(params)) {
    const first = Array.isArray(v) ? v[0] : v;
    if (first !== undefined) out.push([k, first]);
  }
  return out;
}

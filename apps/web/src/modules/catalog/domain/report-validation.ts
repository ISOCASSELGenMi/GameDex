/**
 * 資料更正回報的輸入驗證與日期換算（12 §資料更正回報）。純函式、零外部依賴，API 與表單共用同一份規則（原則五）。
 * 目標是否存在、地區／平台是否有效要查資料庫，不在這裡（use-cases/reports/submit-report.ts）。
 */
import {
  DATE_PRECISIONS,
  LANGUAGE_SUPPORT_TYPES,
  RELEASE_STAGES,
  REPORT_TARGET_TYPES,
  REPORT_TYPES,
  type DatePrecision,
  type IsoDate,
  type ReportProposed,
  type ReportTargetType,
  type ReportType,
} from "./entities";

export const REPORT_NOTE_MAX = 1000;
export const REPORT_URL_MAX = 2000;
/** localized_title 的標題長度上限（trim 後 1～200 字）。 */
export const REPORT_TITLE_MAX = 200;

/** 每種回報類型允許的目標類型，以及是否必須指定目標（12）。 */
export const REPORT_TYPE_RULES: Readonly<Record<ReportType, { targets: readonly ReportTargetType[]; targetRequired: boolean }>> = {
  wrong_date: { targets: ["release_event"], targetRequired: true },
  missing_region_date: { targets: ["game"], targetRequired: true },
  wrong_stage: { targets: ["release_event"], targetRequired: true },
  language_support: { targets: ["game"], targetRequired: true },
  cancelled: { targets: ["release_event", "game"], targetRequired: true },
  localized_title: { targets: ["game"], targetRequired: true },
  duplicate: { targets: ["game", "release_event", "platform", "event"], targetRequired: true },
  takedown: { targets: ["game", "release_event", "platform", "event"], targetRequired: false },
  other: { targets: ["game", "release_event", "platform", "event"], targetRequired: false },
};

/** 日期類回報：來源網址必填（12）。 */
export const DATE_REPORT_TYPES: readonly ReportType[] = ["wrong_date", "missing_region_date"];

/** 某目標類型可選的回報類型（表單用）。 */
export function reportTypesForTarget(targetType: ReportTargetType): ReportType[] {
  return REPORT_TYPES.filter((t) => REPORT_TYPE_RULES[t].targets.includes(targetType));
}

export type ReportFieldError = "required" | "invalid" | "too_long";
export type ReportFieldErrors = Partial<Record<string, ReportFieldError>>;

export interface ValidatedReport {
  reportType: ReportType;
  targetType: ReportTargetType;
  targetId: number | null;
  proposed: ReportProposed | null;
  sourceUrl: string | null;
  note: string | null;
}

export type ReportValidation = { ok: true; value: ValidatedReport } | { ok: false; fields: ReportFieldErrors };

/** 只放行 http(s) 的絕對網址；回傳正規化後的字串，不合格回 null。 */
export function parseHttpUrl(raw: string): string | null {
  const s = raw.trim();
  if (s === "" || s.length > REPORT_URL_MAX) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** `YYYY-MM-DD` 且是真實存在的日期（含閏年）。 */
export function isValidIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1970 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const iso = (y: number, m: number, d: number): IsoDate =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export interface ProposedSpan {
  releaseDate: IsoDate | null;
  periodStart: IsoDate | null;
  precision: DatePrecision;
}

/**
 * 提案日期 → 代表日期與期間起點（03 P24：day＝當日；month＝當月第一天；quarter／year＝期間最後一天；tbd＝NULL）。
 * 與 IGDB 的 normalizeIgdbDate 同一套定義，但輸入是使用者填的日期，所以放在 Domain。
 */
export function spanFromProposed(date: IsoDate | undefined, precision: DatePrecision): ProposedSpan {
  if (precision === "tbd" || !date) return { releaseDate: null, periodStart: null, precision: "tbd" };
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  switch (precision) {
    case "day":
      return { releaseDate: date, periodStart: date, precision };
    case "month": {
      const first = iso(y, m, 1);
      return { releaseDate: first, periodStart: first, precision };
    }
    case "quarter": {
      const startMonth = Math.floor((m - 1) / 3) * 3 + 1;
      const endMonth = startMonth + 2;
      return { releaseDate: iso(y, endMonth, lastDay(y, endMonth)), periodStart: iso(y, startMonth, 1), precision };
    }
    case "year":
      return { releaseDate: iso(y, 12, 31), periodStart: iso(y, 1, 1), precision };
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
const posInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const blank = (v: unknown) => v === undefined || v === null || v === "";

function optionalText(raw: unknown, max: number, field: string, errors: ReportFieldErrors): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    errors[field] = "invalid";
    return null;
  }
  const s = raw.trim();
  if (s === "") return null;
  if (s.length > max) {
    errors[field] = "too_long";
    return null;
  }
  return s;
}

/**
 * 驗證請求本體（POST /api/v1/reports 的 JSON，不含 Turnstile token）。
 * 欄位錯誤以欄位路徑為 key（`sourceUrl`、`proposed.date`…），值是機器可讀的原因，訊息由 UI 以字典呈現。
 */
export function validateReportRequest(raw: unknown): ReportValidation {
  const errors: ReportFieldErrors = {};
  if (!isRecord(raw)) return { ok: false, fields: { body: "invalid" } };

  const reportType = oneOf(REPORT_TYPES, raw.reportType) ? raw.reportType : undefined;
  if (!reportType) errors.reportType = raw.reportType === undefined ? "required" : "invalid";
  const targetType = oneOf(REPORT_TARGET_TYPES, raw.targetType) ? raw.targetType : undefined;
  if (!targetType) errors.targetType = raw.targetType === undefined ? "required" : "invalid";

  let targetId: number | null = null;
  if (!blank(raw.targetId)) {
    if (posInt(raw.targetId)) targetId = raw.targetId;
    else errors.targetId = "invalid";
  }

  const rule = reportType ? REPORT_TYPE_RULES[reportType] : undefined;
  if (rule && targetType) {
    if (!rule.targets.includes(targetType)) errors.targetType = "invalid";
    else if (rule.targetRequired && targetId === null && !errors.targetId) errors.targetId = "required";
  }
  const note = optionalText(raw.note, REPORT_NOTE_MAX, "note", errors);

  // 來源網址：日期類必填；其他類型選填，但填了就必須是 http(s)
  let sourceUrl: string | null = null;
  const rawUrl = optionalText(raw.sourceUrl, REPORT_URL_MAX, "sourceUrl", errors);
  if (rawUrl !== null) {
    sourceUrl = parseHttpUrl(rawUrl);
    if (sourceUrl === null) errors.sourceUrl = "invalid";
  } else if (reportType && DATE_REPORT_TYPES.includes(reportType) && !errors.sourceUrl) {
    errors.sourceUrl = "required";
  }

  if (!blank(raw.proposed) && !isRecord(raw.proposed)) errors.proposed = "invalid";
  const p = isRecord(raw.proposed) ? raw.proposed : {};
  let proposed: ReportProposed | null = null;

  if (reportType === "wrong_date" || reportType === "missing_region_date") {
    const precision = blank(p.precision) ? "day" : oneOf(DATE_PRECISIONS, p.precision) ? p.precision : undefined;
    if (!precision) errors["proposed.precision"] = "invalid";
    let date: string | undefined;
    if (precision !== "tbd") {
      if (blank(p.date)) errors["proposed.date"] = "required";
      else if (typeof p.date !== "string" || !isValidIsoDate(p.date)) errors["proposed.date"] = "invalid";
      else date = p.date;
    }
    let stage: (typeof RELEASE_STAGES)[number] | undefined;
    if (!blank(p.stage)) {
      if (oneOf(RELEASE_STAGES, p.stage)) stage = p.stage;
      else errors["proposed.stage"] = "invalid";
    }
    proposed = { precision: precision ?? "day", ...(date ? { date } : {}), ...(stage ? { stage } : {}) };

    // 補登（目標是遊戲）：平台與地區必填；wrong_date（目標是上市事件）由該事件決定，不收
    if (reportType === "missing_region_date") {
      if (blank(p.platformId)) errors["proposed.platformId"] = "required";
      else if (!posInt(p.platformId)) errors["proposed.platformId"] = "invalid";
      else proposed.platformId = p.platformId;
      if (blank(p.regionCode)) errors["proposed.regionCode"] = "required";
      else if (typeof p.regionCode !== "string" || !/^[A-Za-z]{2,8}$/.test(p.regionCode.trim())) errors["proposed.regionCode"] = "invalid";
      else proposed.regionCode = p.regionCode.trim().toUpperCase();
    }
  } else if (reportType === "wrong_stage") {
    if (blank(p.stage)) errors["proposed.stage"] = "required";
    else if (!oneOf(RELEASE_STAGES, p.stage)) errors["proposed.stage"] = "invalid";
    else proposed = { stage: p.stage };
  } else if (reportType === "language_support") {
    const out: ReportProposed = {};
    if (blank(p.language)) errors["proposed.language"] = "required";
    else if (typeof p.language !== "string" || !/^[A-Za-z0-9-]{2,32}$/.test(p.language.trim())) errors["proposed.language"] = "invalid";
    else out.language = p.language.trim();
    if (blank(p.supportType)) errors["proposed.supportType"] = "required";
    else if (!oneOf(LANGUAGE_SUPPORT_TYPES, p.supportType)) errors["proposed.supportType"] = "invalid";
    else out.supportType = p.supportType;
    proposed = out;
  } else if (reportType === "localized_title") {
    const title = typeof p.title === "string" ? p.title.trim() : "";
    if (blank(p.title) || (typeof p.title === "string" && title === "")) errors["proposed.title"] = "required";
    else if (typeof p.title !== "string") errors["proposed.title"] = "invalid";
    else if (title.length > REPORT_TITLE_MAX) errors["proposed.title"] = "too_long";
    if (!blank(p.locale) && p.locale !== "zh-Hant") errors["proposed.locale"] = "invalid";
    proposed = { title, locale: "zh-Hant" };
  }

  if (Object.keys(errors).length > 0 || !reportType || !targetType) return { ok: false, fields: errors };
  return { ok: true, value: { reportType, targetType, targetId, proposed, sourceUrl, note } };
}

/**
 * field_correction（D92）的欄位形狀表與驗證：24 個欄位鍵各自的值形狀、允許動作、長度上限。純函式、零外部依賴。
 * 公開表單（依形狀顯示輸入欄）、伺服器驗證（domain/report-validation.ts）、待回饋登錄表（domain/igdb-feedback-fields.ts：
 * 整理文字與採納偵測）都由這一份驅動（原則五）。
 */
import {
  FIELD_CORRECTION_KEYS,
  FIELD_OPS,
  FIELD_RELATIONS,
  GAME_STATUSES,
  GAME_TYPES,
  type FieldCompanyRole,
  type FieldCorrectionKey,
  type FieldCorrectionValue,
  type FieldOp,
} from "./entities";

export const FIELD_SHAPES = ["text", "name", "altName", "localizedTitle", "company", "link", "ageRating", "relation", "media"] as const;
export type FieldShape = (typeof FIELD_SHAPES)[number];

/** 表單的欄位分區。 */
export const FIELD_GROUPS = ["text", "media", "taxonomy", "relation", "other"] as const;
export type FieldGroup = (typeof FIELD_GROUPS)[number];

export interface FieldCorrectionSpec {
  shape: FieldShape;
  group: FieldGroup;
  ops: readonly FieldOp[];
  /** text 形狀：只接受這些字典值（game_type、game_status）。 */
  choices?: readonly string[];
  /** text 形狀的長度上限（預設 FC_TEXT_MAX）。 */
  max?: number;
  /** company 形狀：固定角色，或回報者可選的角色。 */
  roles?: readonly FieldCompanyRole[];
}

export const FC_TEXT_MAX = 4000;
export const FC_NAME_MAX = 200;
export const FC_SHORT_MAX = 64;
export const FC_SLUG_MAX = 255;
/** BCP-47 的簡化檢查：`ja`、`zh-Hant`、`pt-BR`、`es-419`。 */
const LOCALE_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;
export const FC_LOCALE_MAX = 16;

const ALL: readonly FieldOp[] = ["add", "change", "remove"];
const CHANGE_ONLY: readonly FieldOp[] = ["change"];

/** 24 個欄位的形狀表。順序即表單下拉的順序（依分區）。 */
export const FIELD_CORRECTION_SPECS: Readonly<Record<FieldCorrectionKey, FieldCorrectionSpec>> = {
  name: { shape: "text", group: "text", ops: CHANGE_ONLY, max: FC_NAME_MAX },
  summary: { shape: "text", group: "text", ops: CHANGE_ONLY },
  storyline: { shape: "text", group: "text", ops: CHANGE_ONLY },
  game_type: { shape: "text", group: "text", ops: CHANGE_ONLY, choices: GAME_TYPES },
  game_status: { shape: "text", group: "text", ops: CHANGE_ONLY, choices: GAME_STATUSES },
  alternative_name: { shape: "altName", group: "text", ops: ALL },
  localized_title_other: { shape: "localizedTitle", group: "text", ops: ALL },
  cover: { shape: "media", group: "media", ops: ["add", "change"] },
  screenshot: { shape: "media", group: "media", ops: ["add", "remove"] },
  video: { shape: "media", group: "media", ops: ALL },
  genre: { shape: "name", group: "taxonomy", ops: ALL },
  theme: { shape: "name", group: "taxonomy", ops: ALL },
  game_mode: { shape: "name", group: "taxonomy", ops: ALL },
  player_perspective: { shape: "name", group: "taxonomy", ops: ALL },
  engine: { shape: "name", group: "taxonomy", ops: ALL },
  platform: { shape: "name", group: "taxonomy", ops: ALL },
  company_developer: { shape: "company", group: "other", ops: ALL, roles: ["developer"] },
  company_publisher: { shape: "company", group: "other", ops: ALL, roles: ["publisher"] },
  company_supporting: { shape: "company", group: "other", ops: ALL, roles: ["supporting", "porting"] },
  franchise: { shape: "name", group: "relation", ops: ALL },
  collection: { shape: "name", group: "relation", ops: ALL },
  external_link: { shape: "link", group: "other", ops: ALL },
  age_rating: { shape: "ageRating", group: "other", ops: ALL },
  relation_parent: { shape: "relation", group: "relation", ops: ALL },
};

export const isFieldCorrectionKey = (v: unknown): v is FieldCorrectionKey =>
  typeof v === "string" && (FIELD_CORRECTION_KEYS as readonly string[]).includes(v);

/** 表單下拉用：依分區排序的欄位鍵。 */
export function fieldKeysByGroup(): Array<{ group: FieldGroup; keys: FieldCorrectionKey[] }> {
  return FIELD_GROUPS.map((group) => ({ group, keys: FIELD_CORRECTION_KEYS.filter((k) => FIELD_CORRECTION_SPECS[k].group === group) })).filter(
    (g) => g.keys.length > 0,
  );
}

/** 某形狀需要的輸入欄（表單依序顯示；required 表示必填）。 */
export interface ValueInput {
  key: keyof FieldCorrectionValue;
  required: boolean;
  max: number;
}

export function valueInputs(key: FieldCorrectionKey): ValueInput[] {
  const spec = FIELD_CORRECTION_SPECS[key];
  switch (spec.shape) {
    case "text":
      return [{ key: "text", required: true, max: spec.max ?? FC_TEXT_MAX }];
    case "name":
      return [{ key: "name", required: true, max: FC_NAME_MAX }];
    case "altName":
      return [{ key: "name", required: true, max: FC_NAME_MAX }, { key: "comment", required: false, max: FC_NAME_MAX }];
    case "localizedTitle":
      return [{ key: "locale", required: true, max: FC_LOCALE_MAX }, { key: "name", required: true, max: FC_NAME_MAX }];
    case "company":
      return [
        { key: "name", required: true, max: FC_NAME_MAX },
        ...((spec.roles?.length ?? 0) > 1 ? [{ key: "role" as const, required: true, max: FC_SHORT_MAX }] : []),
      ];
    case "link":
      return [{ key: "url", required: true, max: 2000 }, { key: "label", required: false, max: FC_SHORT_MAX }];
    case "ageRating":
      return [{ key: "organization", required: true, max: FC_SHORT_MAX }, { key: "rating", required: true, max: FC_SHORT_MAX }];
    case "relation":
      return [
        { key: "relation", required: true, max: FC_SHORT_MAX },
        { key: "gameName", required: true, max: FC_NAME_MAX },
        { key: "gameSlug", required: false, max: FC_SLUG_MAX },
      ];
    case "media":
      return [{ key: "url", required: true, max: 2000 }];
  }
}

export type FieldValueError = "required" | "invalid" | "too_long";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 只放行 http(s) 的絕對網址（與 report-validation 的 parseHttpUrl 同規則；這裡不 import 以免循環）。 */
function httpUrl(raw: string, max: number): string | null {
  const s = raw.trim();
  if (s === "" || s.length > max) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * 驗證一個值物件（`proposed.value` 或 `proposed.oldValue`）。回傳正規化後的值（全部 trim；未知的鍵丟掉），錯誤以 `${prefix}.${鍵}` 記入 errors。
 * 沒有錯誤時才回傳值。
 */
export function validateFieldValue(
  key: FieldCorrectionKey,
  raw: unknown,
  prefix: string,
  errors: Partial<Record<string, FieldValueError>>,
): FieldCorrectionValue | null {
  const spec = FIELD_CORRECTION_SPECS[key];
  if (!isRecord(raw)) {
    errors[prefix] = raw === undefined || raw === null ? "required" : "invalid";
    return null;
  }
  const before = Object.keys(errors).length;
  const out: Record<string, string> = {};
  for (const input of valueInputs(key)) {
    const path = `${prefix}.${input.key}`;
    const v = raw[input.key];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      if (input.required) errors[path] = "required";
      continue;
    }
    if (typeof v !== "string") {
      errors[path] = "invalid";
      continue;
    }
    const s = v.trim();
    if (s.length > input.max) {
      errors[path] = "too_long";
      continue;
    }
    if (input.key === "url") {
      const u = httpUrl(s, input.max);
      if (u === null) errors[path] = "invalid";
      else out.url = u;
      continue;
    }
    if (input.key === "text" && spec.choices && !spec.choices.includes(s)) {
      errors[path] = "invalid";
      continue;
    }
    if (input.key === "locale" && !LOCALE_RE.test(s)) {
      errors[path] = "invalid";
      continue;
    }
    if (input.key === "role" && !(spec.roles as readonly string[]).includes(s)) {
      errors[path] = "invalid";
      continue;
    }
    if (input.key === "relation" && !(FIELD_RELATIONS as readonly string[]).includes(s)) {
      errors[path] = "invalid";
      continue;
    }
    if (input.key === "gameSlug" && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s)) {
      errors[path] = "invalid";
      continue;
    }
    out[input.key] = s;
  }
  // 固定角色的公司欄位（開發商、發行商）：角色由欄位決定
  if (spec.shape === "company" && spec.roles?.length === 1) out.role = spec.roles[0];
  return Object.keys(errors).length === before ? (out as FieldCorrectionValue) : null;
}

export interface ValidatedFieldCorrection {
  field: FieldCorrectionKey;
  op: FieldOp;
  value: FieldCorrectionValue;
  oldValue?: FieldCorrectionValue;
}

/**
 * 驗證 field_correction 的 proposed。field 必須在形狀表；op 必須是該欄位允許的；每種動作都要 value；
 * oldValue 只在 change 時、非 text 形狀（text 形狀的舊值由核可時的我方資料決定）才收。錯誤記入 errors，沒有錯誤才回傳。
 */
export function validateFieldCorrection(p: Record<string, unknown>, errors: Partial<Record<string, FieldValueError>>): ValidatedFieldCorrection | null {
  const before = Object.keys(errors).length;
  if (p.field === undefined || p.field === null || p.field === "") errors["proposed.field"] = "required";
  else if (!isFieldCorrectionKey(p.field)) errors["proposed.field"] = "invalid";
  const field = isFieldCorrectionKey(p.field) ? p.field : null;

  let op: FieldOp | null = null;
  if (p.op === undefined || p.op === null || p.op === "") errors["proposed.op"] = "required";
  else if (typeof p.op !== "string" || !(FIELD_OPS as readonly string[]).includes(p.op)) errors["proposed.op"] = "invalid";
  else if (field && !FIELD_CORRECTION_SPECS[field].ops.includes(p.op as FieldOp)) errors["proposed.op"] = "invalid";
  else op = p.op as FieldOp;

  if (!field) return null;
  const value = validateFieldValue(field, p.value, "proposed.value", errors);
  let oldValue: FieldCorrectionValue | undefined;
  if (p.oldValue !== undefined && p.oldValue !== null && !(isRecord(p.oldValue) && Object.keys(p.oldValue).length === 0)) {
    if (op !== "change" || FIELD_CORRECTION_SPECS[field].shape === "text") errors["proposed.oldValue"] = "invalid";
    else oldValue = validateFieldValue(field, p.oldValue, "proposed.oldValue", errors) ?? undefined;
  }
  if (Object.keys(errors).length !== before || !op || !value) return null;
  return { field, op, value, ...(oldValue ? { oldValue } : {}) };
}

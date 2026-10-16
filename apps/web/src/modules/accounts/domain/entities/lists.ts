/**
 * 收藏清單（09 §收藏清單、03 user_lists／user_list_games）：我方型別與驗證規則。純函式、零外部依賴。
 * 可見度預設取 users.defaultListVisibility（預設 private，P37）。
 */
import { LIST_VISIBILITIES } from "./providers";

export type ListVisibility = (typeof LIST_VISIBILITIES)[number];
export function isListVisibility(value: unknown): value is ListVisibility {
  return typeof value === "string" && (LIST_VISIBILITIES as readonly string[]).includes(value);
}

/** 每位使用者的清單上限、每個清單的遊戲上限、各文字欄位長度。超過回 422。 */
export const LIST_MAX_PER_USER = 100;
export const LIST_GAMES_MAX = 1000;
export const LIST_NAME_MAX = 100;
export const LIST_DESCRIPTION_MAX = 1000;
export const LIST_NOTE_MAX = 500;
/** GET /lists/{id} 的遊戲分頁。 */
export const LIST_GAMES_PAGE_DEFAULT = 100;
export const LIST_GAMES_PAGE_MAX = 200;
/** shareToken：crypto.randomBytes(18) 的 base64url＝24 字元（欄位上限 32）。 */
export const SHARE_TOKEN_BYTES = 18;
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,32}$/;

/** 欄位層級的驗證錯誤：key＝欄位名，value＝原因碼。 */
export type FieldErrors = Record<string, string>;

export type Validated<T> = { ok: true; value: T } | { ok: false; fields: FieldErrors };

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 字串欄位：trim；空字串視為 null（僅 nullable 欄位）。 */
export function readText(
  body: Record<string, unknown>,
  key: string,
  max: number,
  fields: FieldErrors,
  opts: { nullable: boolean; required: boolean },
): string | null | undefined {
  if (!(key in body) || body[key] === undefined) {
    if (opts.required) fields[key] = "required";
    return undefined;
  }
  const raw = body[key];
  if (raw === null) {
    if (opts.nullable) return null;
    fields[key] = "required";
    return undefined;
  }
  if (typeof raw !== "string") {
    fields[key] = "invalid";
    return undefined;
  }
  const t = raw.trim();
  if (t === "") {
    if (opts.nullable) return null;
    fields[key] = "required";
    return undefined;
  }
  if ([...t].length > max) {
    fields[key] = "too_long";
    return undefined;
  }
  return t;
}

export interface ListCreateInput {
  name: string;
  description: string | null;
  /** undefined＝用 users.defaultListVisibility。 */
  visibility: ListVisibility | undefined;
}

export function validateListCreate(body: unknown): Validated<ListCreateInput> {
  if (!isRecord(body)) return { ok: false, fields: { body: "invalid" } };
  const fields: FieldErrors = {};
  const name = readText(body, "name", LIST_NAME_MAX, fields, { nullable: false, required: true });
  const description = readText(body, "description", LIST_DESCRIPTION_MAX, fields, { nullable: true, required: false });
  let visibility: ListVisibility | undefined;
  if (body.visibility !== undefined) {
    if (isListVisibility(body.visibility)) visibility = body.visibility;
    else fields.visibility = "invalid";
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: { name: name as string, description: description ?? null, visibility } };
}

export interface ListPatchInput {
  name?: string;
  description?: string | null;
  visibility?: ListVisibility;
  /** true＝重新產生 shareToken（只在 unlisted 時有意義）。 */
  rotateShareToken?: boolean;
}

export function validateListPatch(body: unknown): Validated<ListPatchInput> {
  if (!isRecord(body)) return { ok: false, fields: { body: "invalid" } };
  const fields: FieldErrors = {};
  const out: ListPatchInput = {};
  const name = readText(body, "name", LIST_NAME_MAX, fields, { nullable: false, required: false });
  if (name !== undefined && name !== null) out.name = name;
  const description = readText(body, "description", LIST_DESCRIPTION_MAX, fields, { nullable: true, required: false });
  if (description !== undefined) out.description = description;
  if (body.visibility !== undefined) {
    if (isListVisibility(body.visibility)) out.visibility = body.visibility;
    else fields.visibility = "invalid";
  }
  if (body.rotateShareToken !== undefined) {
    if (typeof body.rotateShareToken === "boolean") out.rotateShareToken = body.rotateShareToken;
    else fields.rotateShareToken = "invalid";
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  if (Object.keys(out).length === 0) return { ok: false, fields: { body: "empty" } };
  return { ok: true, value: out };
}

/** 清單內單款遊戲的備註：{ note: string | null }（空字串＝清除）。省略 note 的 POST 視為不改備註。 */
export function validateListNote(body: unknown, opts: { required: boolean }): Validated<{ note: string | null | undefined }> {
  if (body === undefined || body === null) return opts.required ? { ok: false, fields: { note: "required" } } : { ok: true, value: { note: undefined } };
  if (!isRecord(body)) return { ok: false, fields: { body: "invalid" } };
  const fields: FieldErrors = {};
  const note = readText(body, "note", LIST_NOTE_MAX, fields, { nullable: true, required: opts.required });
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: { note } };
}

/** 排序 body：整數 id 陣列（不得重複、上限 max）。 */
export function validateIdOrder(body: unknown, key: string, max: number): Validated<number[]> {
  if (!isRecord(body)) return { ok: false, fields: { body: "invalid" } };
  const raw = body[key];
  if (!Array.isArray(raw)) return { ok: false, fields: { [key]: "required" } };
  if (raw.length > max) return { ok: false, fields: { [key]: "too_many" } };
  const ids: number[] = [];
  for (const v of raw) {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) return { ok: false, fields: { [key]: "invalid" } };
    ids.push(v);
  }
  if (new Set(ids).size !== ids.length) return { ok: false, fields: { [key]: "duplicate" } };
  return { ok: true, value: ids };
}

/**
 * 排序合併：`requested` 排最前面（依給定順序），沒被提到的維持原本相對順序接在後面。
 * 呼叫端要先確認 requested 都在 current 內。
 */
export function mergeOrder(current: readonly number[], requested: readonly number[]): number[] {
  const asked = new Set(requested);
  return [...requested, ...current.filter((id) => !asked.has(id))];
}

/** 路徑參數的正整數 id；不合法回 null。 */
export function parseIdParam(raw: string): number | null {
  if (!/^[0-9]{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
}

/** 清單在 API 的樣子（摘要）。shareToken 只給本人，且只在 unlisted。 */
export interface ListSummaryView {
  id: number;
  name: string;
  description: string | null;
  visibility: ListVisibility;
  shareToken: string | null;
  sortOrder: number;
  gameCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListOwnerView {
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
}

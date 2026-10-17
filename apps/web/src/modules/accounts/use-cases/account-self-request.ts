/**
 * /api/v1/account（刪除）、/account/export、/account/preferences 的 HTTP 處理（07；薄路由 app/api/v1/account/** 經 api/account-self.ts 呼叫）。
 * 慣例同 account-data-request.ts：寫入先 403（Origin）再 401；錯誤一律 { code }；一律 Cache-Control: no-store。
 * 連結的登入方式（07 的 account/connections/{provider}）不另做：Better Auth 的 /api/v1/auth/list-accounts、/unlink-account、/steam/sign-in、/link-social 已涵蓋。
 */
import {
  ACCOUNT_DELETE_RATE_LIMIT,
  ACCOUNT_EXPORT_RATE_LIMIT,
  ACCOUNT_PREFERENCES_RATE_LIMIT,
  EXPORT_FORMATS,
  isExportCsvPart,
  parseDeleteBody,
  type ExportFormat,
} from "../domain/entities/account-self";
import { exportCsvPart } from "../domain/entities/account-export-csv";
import { authenticate, code, invalid, json, methodNotAllowed, readBody } from "./account-data-request";
import { buildAccountExport, deleteAccount, getAccountSummary, getPreferences, parsePreferencesPatch, patchPreferences } from "./account-self";
import { getAuth } from "./auth-instance";
import { consumeRate } from "./rate-limit";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function rateLimited(retryAfterSeconds: number): Response {
  return json({ code: "rate_limited" }, 429, { "Retry-After": String(retryAfterSeconds) });
}

function withCookies(res: Response, cookies: readonly string[]): Response {
  for (const c of cookies) res.headers.append("set-cookie", c);
  return res;
}

/** 目前 session 的建立時間（重新驗證的「新鮮度」判斷）。cookie cache 內的日期可能是字串。 */
async function currentSessionCreatedAt(headers: Headers): Promise<Date | null> {
  const session = await getAuth().api.getSession({ headers });
  if (!session) return null;
  const at = new Date(session.session.createdAt as unknown as string | Date);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * 以 Better Auth 的 sign-out 產生「清掉 session cookie」的 Set-Cookie（cookie 名稱、前綴、cookie cache 都由它決定，不手寫）。
 * 使用者已被刪除，sign-out 找不到 session 也不會出錯。
 */
async function clearedSessionCookies(headers: Headers): Promise<string[]> {
  try {
    const res = await getAuth().api.signOut({ headers, asResponse: true });
    return res.headers.getSetCookie();
  } catch {
    return [];
  }
}

/** /api/v1/account 的入口：GET＝帳號狀態、DELETE＝刪除帳號（handleAccountDelete 是同一個函式，沿用舊名稱）。 */
export async function handleAccount(request: Request): Promise<Response> {
  return handleAccountDelete(request);
}

// ── GET /api/v1/account ──────────────────────────────────────────────────

/** 目前帳號狀態 `{ suspended }`（D83：帳號頁與各子頁依此顯示「帳號已停權」說明；本人可讀）。 */
async function handleAccountStatus(request: Request): Promise<Response> {
  const a = await authenticate(request, false);
  if ("response" in a) return a.response;
  return json({ suspended: a.user.suspended }, 200);
}

// ── GET /api/v1/account/summary ──────────────────────────────────────────

/** 帳號頁摘要 `{ lists, playRecords, follows }`（本人；停權帳號回 403，同其他資料端點）。no-store。 */
export async function handleAccountSummary(request: Request): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const a = await authenticate(request, false);
  if ("response" in a) return a.response;
  return json(await getAccountSummary(a.user.id), 200);
}

// ── DELETE /api/v1/account ───────────────────────────────────────────────

/**
 * 刪除帳號。body `{ password? }`。
 * 200 `{ ok: true }`（同時清掉 session cookie）｜400 validation_failed（password: required／invalid）｜401 invalid_password／reauth_required／unauthorized｜
 * 403 invalid_origin｜429 rate_limited。
 */
export async function handleAccountDelete(request: Request): Promise<Response> {
  if (request.method === "GET") return handleAccountStatus(request);
  if (request.method !== "DELETE") return methodNotAllowed("GET, DELETE");
  const a = await authenticate(request, true, { allowSuspended: true }); // 停權者也能刪除自己的帳號（D83）
  if ("response" in a) return a.response;
  const limit = consumeRate("account-delete", a.user.id, ACCOUNT_DELETE_RATE_LIMIT);
  if (!limit.ok) return rateLimited(limit.retryAfterSeconds);
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const parsed = parseDeleteBody(b.body);
  if (!parsed.ok) return invalid(parsed.fields);
  const createdAt = await currentSessionCreatedAt(request.headers);
  if (!createdAt) return code("unauthorized", 401);

  const res = await deleteAccount({ userId: a.user.id, password: parsed.value.password, sessionCreatedAt: createdAt });
  if (!res.ok) {
    switch (res.code) {
      case "password_required":
        return invalid({ password: "required" });
      case "invalid_password":
        return code("invalid_password", 401);
      case "reauth_required":
        return code("reauth_required", 401);
      case "user_not_found":
        return code("unauthorized", 401);
    }
  }
  return withCookies(json({ ok: true }, 200), await clearedSessionCookies(request.headers));
}

// ── GET /api/v1/account/export ───────────────────────────────────────────

const dateStamp = (d: Date) => d.toISOString().slice(0, 10);

/**
 * `?format=json`（預設）｜`?format=csv&part=profile|lists|list_games|plays|follows|owned_games`。
 * 內容含本人的私人筆記，所以 no-store、attachment；不含密碼雜湊、任何 token、私人行事曆的 feed token。
 */
export async function handleAccountExport(request: Request): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const a = await authenticate(request, false);
  if ("response" in a) return a.response;
  const params = new URL(request.url).searchParams;
  const rawFormat = params.get("format") ?? "json";
  if (!(EXPORT_FORMATS as readonly string[]).includes(rawFormat)) return invalid({ format: "invalid" });
  const format = rawFormat as ExportFormat;
  const part = params.get("part");
  if (format === "csv") {
    if (part === null) return invalid({ part: "required" });
    if (!isExportCsvPart(part)) return invalid({ part: "invalid" });
  }
  const limit = consumeRate("account-export", a.user.id, ACCOUNT_EXPORT_RATE_LIMIT);
  if (!limit.ok) return rateLimited(limit.retryAfterSeconds);

  const now = new Date();
  const data = await buildAccountExport(a.user.id, now);
  if (!data) return code("unauthorized", 401);
  const headers = { ...NO_STORE, "X-Content-Type-Options": "nosniff" };
  if (format === "json") {
    return new Response(JSON.stringify(data, null, 2), {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="sok-export-${dateStamp(now)}.json"` },
    });
  }
  return new Response(exportCsvPart(data, part as Parameters<typeof exportCsvPart>[1]), {
    status: 200,
    headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sok-${part}-${dateStamp(now)}.csv"` },
  });
}

// ── GET|PATCH /api/v1/account/preferences ────────────────────────────────

/**
 * GET → `{ preferences }`；PATCH body 任一欄位 → `{ preferences, changed }`。
 * 欄位：displayName、locale、timezone、preferredRegion、scoreProviders、preferredPlatformIds、defaultListVisibility、defaultReviewVisibility
 * （可清除的欄位傳 null）。改顯示名稱時順便重新發出 session cookie cache（header 馬上看到新名稱）。
 */
export async function handleAccountPreferences(request: Request): Promise<Response> {
  if (request.method === "GET") {
    const a = await authenticate(request, false);
    if ("response" in a) return a.response;
    const preferences = await getPreferences(a.user.id);
    return preferences ? json({ preferences }, 200) : code("unauthorized", 401);
  }
  if (request.method !== "PATCH") return methodNotAllowed("GET, PATCH");
  const a = await authenticate(request, true);
  if ("response" in a) return a.response;
  const limit = consumeRate("account-preferences", a.user.id, ACCOUNT_PREFERENCES_RATE_LIMIT);
  if (!limit.ok) return rateLimited(limit.retryAfterSeconds);
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const v = parsePreferencesPatch(b.body);
  if (!v.ok) return invalid(v.fields);
  const res = await patchPreferences(a.user.id, v.value);
  if (!res.ok) return res.code === "validation_failed" ? invalid(res.fields) : code("unauthorized", 401);
  const out = json({ preferences: res.preferences, changed: res.changed }, 200);
  if (res.changed && v.value.displayName !== undefined) {
    try {
      const refreshed = await getAuth().api.getSession({ headers: request.headers, query: { disableCookieCache: true }, asResponse: true });
      withCookies(out, refreshed.headers.getSetCookie());
    } catch {
      // cookie cache 最多 5 分鐘後自然更新；失敗不影響儲存
    }
  }
  return out;
}

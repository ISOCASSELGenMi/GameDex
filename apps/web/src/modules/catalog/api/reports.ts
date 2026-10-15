/**
 * POST /api/v1/reports（07、12）：資料更正回報。允許匿名；每 IP 每日上限＋Turnstile。
 * app/api/v1/reports/route.ts 只是薄路由。
 *
 * 請求（JSON）：{ reportType, targetType, targetId?, proposed?, sourceUrl?, note?, turnstileToken? }
 * 回應（一律 Cache-Control: no-store）：
 *   201 { id, status: "open" }
 *   400 { error: "invalid_json" | "validation_failed", fields? }  欄位錯誤以欄位路徑為 key（例：proposed.date）
 *   403 { error: "captcha_failed" }
 *   413 { error: "payload_too_large" }
 *   429 { error: "rate_limited" } ＋ Retry-After
 *   503 { error: "captcha_unavailable" | "service_unavailable" }
 */
import { connection } from "next/server";
import { submitReport } from "../use-cases/reports";

const MAX_BODY_BYTES = 16 * 1024;
const NO_STORE = { "Cache-Control": "no-store" } as const;

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...extra } });
}

/** 客戶端 IP：Cloudflare 的 CF-Connecting-IP 優先，其次 X-Forwarded-For 第一段、X-Real-IP。正式環境在 Cloudflare／Caddy 後面。 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const xff = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return xff;
  return headers.get("x-real-ip")?.trim() || null;
}

export async function POST(request: Request): Promise<Response> {
  await connection();
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const record = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const token = record && typeof record.turnstileToken === "string" ? record.turnstileToken : null;

  const result = await submitReport({ body, turnstileToken: token, clientIp: clientIpFromHeaders(request.headers) });
  if (result.ok) return json({ id: result.id, status: result.status }, 201);
  switch (result.error) {
    case "validation_failed":
      return json({ error: "validation_failed", fields: result.fields }, 400);
    case "rate_limited":
      return json({ error: "rate_limited" }, 429, { "Retry-After": String(result.retryAfterSeconds) });
    case "captcha_failed":
      return json({ error: "captcha_failed" }, 403);
    case "captcha_unavailable":
      return json({ error: "captcha_unavailable" }, 503);
    case "not_configured":
      console.error(`[reports] 設定缺漏：${result.missing}`);
      return json({ error: "service_unavailable" }, 503);
  }
}

// @module kernel
// 語言選單點選時寫入語系偏好 Cookie 的專用端點（06 §多語系：一般頁面回應不寫 Cookie）。
// 用法：navigator.sendBeacon("/api/locale", "en")（body 為語系代碼純文字），或表單 POST locale=en。
import { buildLocaleCookie, getLocaleConfig, isSupportedLocale } from "@/kernel/locale";

async function readLocale(request: Request): Promise<string> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const form = await request.formData();
    const v = form.get("locale");
    return typeof v === "string" ? v.trim() : "";
  }
  const text = await request.text();
  return text.slice(0, 32).trim();
}

export async function POST(request: Request): Promise<Response> {
  const locale = await readLocale(request);
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) {
    return new Response(null, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const secure = new URL(request.url).protocol === "https:";
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": buildLocaleCookie(locale, { secure }), "Cache-Control": "no-store" },
  });
}

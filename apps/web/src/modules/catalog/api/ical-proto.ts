/**
 * 原型驗證用 feed（08、15 Phase 5）：`/ical/_proto/{a|b}.ics`。只在 ICAL_PROTO_ENABLED=true 時存在，否則 404；不進 sitemap。
 * 內容由 .local/ical-proto/state.json 決定（scripts/ical-proto.ts 切換情境），用和正式 feed 同一個產生函式輸出，不讀寫資料庫。
 * 每次請求都重讀狀態檔，`Cache-Control: no-cache`（驗證時要馬上看到變化）。
 */
import { connection } from "next/server";
import { createHash } from "node:crypto";
import { getCoreEnv } from "@/kernel/config/env";
import { getLocaleConfig } from "@/kernel/locale";
import { icalLinks, ICAL_CONTENT_TYPE, slugFromIcsFile } from "./ical";
import { appendProtoAccess, icalUidDomain, isProtoFeedName, renderStoredProtoFeed, ifNoneMatchHits } from "../use-cases/ical";

const NOT_FOUND = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } as const;

export async function protoFeedResponse(request: Request, file: string): Promise<Response> {
  const env = getCoreEnv();
  if (!env.ICAL_PROTO_ENABLED) return new Response("not found", { status: 404, headers: NOT_FOUND });
  const name = slugFromIcsFile(file);
  if (!name || !isProtoFeedName(name)) return new Response("not found", { status: 404, headers: NOT_FOUND });
  await connection();
  const locale = getLocaleConfig().defaultLocale;
  const body = await renderStoredProtoFeed(name, {
    locale,
    uidDomain: icalUidDomain(env.NEXT_PUBLIC_SITE_URL),
    links: icalLinks(locale, request),
  });
  if (body === null) return new Response("not initialised: run `npm -w apps/web run ical:proto -- init`", { status: 404, headers: NOT_FOUND });
  const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;
  const headers = { "Cache-Control": "no-cache", ETag: etag, "X-Robots-Tag": "noindex" };
  const hit = ifNoneMatchHits(request.headers.get("if-none-match"), etag);
  // 原型驗證用：記錄誰在何時抓（觀察 Google／Apple 的拉取間隔）
  const line = `${new Date().toISOString()} ${name} ${hit ? 304 : 200} ua=${request.headers.get("user-agent") ?? "-"}`;
  console.info(`[ical-proto] ${line}`);
  await appendProtoAccess(line);
  if (hit) return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers: { ...headers, "Content-Type": ICAL_CONTENT_TYPE } });
}

/**
 * GET／POST /api/v1/me/unlocks（Z3B；07）。慣例同 account-data-request.ts：寫入先 403（Origin）再 401 再 403（停權）；錯誤一律 { code }；no-store。
 * GET 會把帳號資料判定的成就寫入 user_unlocks，所以視同寫入（mutates）：停權者 403 account_suspended。
 */
import { UNLOCK_POST_MAX } from "../domain/entities/unlocks";
import { authenticate, invalid, json, methodNotAllowed, readBody } from "./account-data-request";
import { consumeRate } from "./rate-limit";
import { getMyUnlocks, pushMyUnlocks } from "./unlocks";

const UNLOCK_POST_RATE_LIMIT = { max: 300, windowMs: 60 * 60 * 1000 } as const;

export async function handleUnlocks(request: Request): Promise<Response> {
  if (request.method === "GET") {
    const a = await authenticate(request, false, { mutates: true });
    if ("response" in a) return a.response;
    return json({ unlocks: await getMyUnlocks(a.user.id) }, 200);
  }
  if (request.method !== "POST") return methodNotAllowed("GET, POST");
  const a = await authenticate(request, true);
  if ("response" in a) return a.response;
  const limit = consumeRate("unlocks-post", a.user.id, UNLOCK_POST_RATE_LIMIT);
  if (!limit.ok) return json({ code: "rate_limited" }, 429, { "Retry-After": String(limit.retryAfterSeconds) });
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const body = b.body;
  const list = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>).unlocks : undefined;
  if (!Array.isArray(list)) return invalid({ unlocks: "required" });
  if (list.length > UNLOCK_POST_MAX) return invalid({ unlocks: "too_many" });
  return json({ unlocks: await pushMyUnlocks(a.user.id, list) }, 200);
}

/**
 * POST /internal/igdb-feedback/action：待回饋 IGDB 項目的標已提交／略過／改回待回饋，單筆或批次（12 §待回饋 IGDB 清單）。
 * app/internal/igdb-feedback/action/route.ts 是薄路由（Next 不允許同一路徑同時有 page 與 route，所以用子路徑）。
 * 表單欄位：act（`<submit|skip|reopen>:<項目 id|batch>`）、ids（批次勾選，可多個）、note-<id>／batchNote、status（回到哪個分頁）、csrf。
 * 成功後 303 回清單頁，結果以 query 帶回。檢查順序：Basic auth → 同源 → CSRF → 動作。
 */
import { connection } from "next/server";
import { IGDB_FEEDBACK_ACTIONS, IGDB_FEEDBACK_STATUSES, updateIgdbFeedback, type IgdbFeedbackAction } from "@/modules/catalog";
import { NO_STORE, checkAdminPost, redirectBack } from "./admin-post";

const PAGE = "/internal/igdb-feedback";
const isAction = (v: string): v is IgdbFeedbackAction => (IGDB_FEEDBACK_ACTIONS as readonly string[]).includes(v);

export async function POST(request: Request): Promise<Response> {
  await connection();
  const check = await checkAdminPost(request);
  if (!check.ok) return check.response;
  const { form } = check;

  const match = /^([a-z]+):(batch|\d{1,9})$/.exec(String(form.get("act") ?? ""));
  if (!match || !isAction(match[1]!)) return new Response("Bad Request", { status: 400, headers: NO_STORE });
  const action = match[1];
  const target = match[2]!;
  const ids = target === "batch" ? form.getAll("ids").map((v) => (typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : NaN)) : [Number(target)];
  const note = form.get(target === "batch" ? "batchNote" : `note-${target}`);
  if (note !== null && typeof note !== "string") return new Response("Bad Request", { status: 400, headers: NO_STORE });

  const rawStatus = form.get("status");
  const tab: Record<string, string> = typeof rawStatus === "string" && (IGDB_FEEDBACK_STATUSES as readonly string[]).includes(rawStatus) && rawStatus !== "pending" ? { status: rawStatus } : {};

  const res = await updateIgdbFeedback(ids, action, note);
  if (!res.ok) return redirectBack(PAGE, { ...tab, error: res.error });
  return redirectBack(PAGE, { ...tab, done: action, n: String(res.updated) });
}

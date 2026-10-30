/**
 * POST /internal/settings/save：儲存或還原一組設定（12 §設定頁）。app/internal/settings/save/route.ts 是薄路由。
 * 表單欄位：group（ratings|calendar|metacritic）、mode（save|reset）、各組欄位、csrf。成功後 303 回設定頁，結果以 query 帶回。
 */
import { connection } from "next/server";
import { SettingsValidationError } from "@/kernel/settings";
import { SETTINGS_GROUPS, saveSettings, type SettingsGroup } from "../use-cases/settings";
import { NO_STORE, checkAdminPost, redirectBack } from "./admin-post";

const isGroup = (v: unknown): v is SettingsGroup => typeof v === "string" && (SETTINGS_GROUPS as readonly string[]).includes(v);

export async function POST(request: Request): Promise<Response> {
  await connection();
  const check = await checkAdminPost(request);
  if (!check.ok) return check.response;
  const group = check.form.get("group");
  const mode = check.form.get("mode");
  if (!isGroup(group) || (mode !== "save" && mode !== "reset")) return new Response("Bad Request", { status: 400, headers: NO_STORE });
  try {
    const res = await saveSettings(group, mode, check.form, check.actor);
    if (!res.ok) return redirectBack("/internal/settings", { error: res.error, group });
    return redirectBack("/internal/settings", { saved: group, mode, changed: String(res.applied.length) });
  } catch (err) {
    if (err instanceof SettingsValidationError) return redirectBack("/internal/settings", { error: err.message, group });
    throw err;
  }
}

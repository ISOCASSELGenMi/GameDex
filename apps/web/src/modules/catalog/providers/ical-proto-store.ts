/**
 * 原型驗證用 feed 的狀態檔讀寫（本機檔案，git 忽略；不碰資料庫）。
 * 目錄：預設 `<repo>/.local/ical-proto`（從 apps/web 執行時為 ../../.local/ical-proto），可用 ICAL_PROTO_DIR 覆寫。
 * 檔案：state.json（目前情境）、log.md（每一步的紀錄）。
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function protoDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const override = env.ICAL_PROTO_DIR?.trim();
  return override ? path.resolve(override) : path.resolve(process.cwd(), "../../.local/ical-proto");
}

/** state.json 的原始 JSON；檔案不存在 → null；內容壞掉 → 丟錯。 */
export async function readProtoStateRaw(dir = protoDir()): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, "state.json"), "utf8")) as unknown;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeProtoStateRaw(state: unknown, dir = protoDir()): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function appendProtoLog(text: string, dir = protoDir()): Promise<void> {
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, "log.md"), text, "utf8");
}

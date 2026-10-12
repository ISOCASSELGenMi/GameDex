import type { DbOrTx } from "@/kernel/db/client";
import { changeFeed } from "../schema";

export type ChangeEntityType = "release_event" | "game" | "event";
export type ChangeType = "created" | "date_changed" | "status_changed" | "removed" | "restored";

/**
 * 寫入 change_feed（03 §change_feed 規則）。
 * 必須與變更在同一個 transaction 內呼叫——所以只接受呼叫端傳入的 tx，不自己開連線。
 */
export async function appendChange(
  tx: DbOrTx,
  entry: { entityType: ChangeEntityType; entityId: number; changeType: ChangeType; payload?: Record<string, unknown> },
): Promise<void> {
  await tx.insert(changeFeed).values(entry);
}

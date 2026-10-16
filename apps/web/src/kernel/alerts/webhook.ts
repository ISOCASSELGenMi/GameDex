/**
 * 告警通道（16 §營運：`ALERT_WEBHOOK_URL`，例如 Discord webhook）。kernel 與 catalog 共用的唯一實作
 * （任務心跳告警在 kernel，資料更正回報的下架通知在 catalog；catalog 的 providers/alert-webhook.ts 只是轉出）。
 * 同時送 `content`（Discord）與 `text`（Slack 相容）兩個欄位，兩邊各取所需、忽略另一個。
 * 失敗回 false，不丟例外：告警不可影響主流程。
 */
export async function sendAlertWebhook(url: string, message: string, opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<boolean> {
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message.slice(0, 1800), text: message.slice(0, 1800) }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

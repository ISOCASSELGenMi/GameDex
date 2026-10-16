/**
 * 寄信介面（7.5 換成真實 provider 時只換實作，不動 Better Auth 設定；09 §Email＋密碼）。
 * Phase 7 預設實作把連結印到 server log（開發用，不寄出）。placeholder 信箱（D77）一律略過。
 */
import { isPlaceholderEmail } from "../../domain/entities/email";

export interface AccountMailMessage {
  to: string;
  displayName: string;
  url: string;
}

export interface AccountMailer {
  sendVerification(message: AccountMailMessage): Promise<void>;
  sendPasswordReset(message: AccountMailMessage): Promise<void>;
}

/** 包一層：收件人是 placeholder 信箱時不送（唯一判斷點）。 */
export function skipPlaceholderRecipients(inner: AccountMailer): AccountMailer {
  return {
    sendVerification: (m) => (isPlaceholderEmail(m.to) ? Promise.resolve() : inner.sendVerification(m)),
    sendPasswordReset: (m) => (isPlaceholderEmail(m.to) ? Promise.resolve() : inner.sendPasswordReset(m)),
  };
}

/** 開發用：只寫 server log。連結含一次性 token，正式環境接上真實寄信前不應依賴它。 */
export function createLogMailer(log: (line: string) => void = (line) => console.info(line)): AccountMailer {
  return {
    sendVerification: async (m) => log(`[accounts] (mailer=log) 驗證信 → ${m.to}：${m.url}`),
    sendPasswordReset: async (m) => log(`[accounts] (mailer=log) 重設密碼 → ${m.to}：${m.url}`),
  };
}

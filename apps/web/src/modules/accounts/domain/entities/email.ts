/**
 * 沒有信箱的帳號（Steam、部分 X 帳號；D77）：users.email 為 NOT NULL＋unique，
 * 缺信箱時填 `<外部 id>@<provider>.placeholder.invalid`（.invalid 為保留網域，不會寄達）。
 * 寄信、重設密碼、顯示信箱一律先用 isPlaceholderEmail() 略過（唯一實作）。
 */
export const PLACEHOLDER_EMAIL_SUFFIX = ".placeholder.invalid";

export function placeholderEmail(externalId: string, provider: string): string {
  return `${externalId}@${provider}${PLACEHOLDER_EMAIL_SUFFIX}`.toLowerCase();
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  return email.slice(at + 1).toLowerCase().endsWith(PLACEHOLDER_EMAIL_SUFFIX);
}

/**
 * 複製文字到剪貼簿的唯一實作（私人行事曆網址、清單分享網址共用）。
 * 先試 Clipboard API；沒有權限或非安全環境時退回「暫時 textarea＋execCommand('copy')」。回傳是否成功；
 * 失敗時呼叫端要把文字露出來讓使用者自己選取複製。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 退回舊方法
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

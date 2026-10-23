/**
 * 月曆「遊戲／活動」開關換頁時的 View Transition 標記（GameDex 第 2 輪）。
 * 跨文件 View Transition 的 types 要在「新頁面」的 pagereveal 事件裡加（舊頁面 pageswap 加的只影響舊頁面的快照），
 * 而 pagereveal 在水合之前就觸發，所以監聽器放在 <head> 的 inline script（TOGGLE_TRANSITION_SCRIPT）：
 * 點開關時 ShowSwitches 在 sessionStorage 寫入時間戳，新頁面的 pagereveal 讀到（5 秒內有效）就加上 `cal-toggle`，
 * globals.css 據此把月曆本體改成 120ms 淡入（換月仍是 380ms 浮入）。不支援跨文件 View Transition 的瀏覽器不受影響。
 */
export const TOGGLE_TRANSITION_KEY = "sok-vt-cal-toggle";
export const TOGGLE_TRANSITION_TYPE = "cal-toggle";
export const TOGGLE_TRANSITION_MAX_AGE_MS = 5000;

export const TOGGLE_TRANSITION_SCRIPT = `addEventListener("pagereveal",function(e){try{var k=${JSON.stringify(TOGGLE_TRANSITION_KEY)},s=sessionStorage.getItem(k);if(s){sessionStorage.removeItem(k);if(e.viewTransition&&Date.now()-Number(s)<${TOGGLE_TRANSITION_MAX_AGE_MS})e.viewTransition.types.add(${JSON.stringify(TOGGLE_TRANSITION_TYPE)})}}catch(x){}})`;

/** 點開關時呼叫：標記「下一次換頁是切換開關」。 */
export function markToggleNavigation(): void {
  try {
    sessionStorage.setItem(TOGGLE_TRANSITION_KEY, String(Date.now()));
  } catch {
    /* 私密視窗或封鎖儲存：沒有動畫而已 */
  }
}

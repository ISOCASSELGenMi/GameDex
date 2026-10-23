/**
 * 搜尋候選 combobox 的鍵盤狀態機（純函式，單元測試用；WAI-ARIA combobox 的 list autocomplete 模式）。
 * - `count`＝清單中可選的項目數（候選 + 最後一列「查看全部結果」）；`active`＝-1 表示沒有選中項（焦點留在輸入框）。
 * - ↑↓ 移動選取並繞回；Enter 在有選中項時進入該項，沒有選中項時不處理（讓表單照常送出＝現有搜尋）；
 *   Esc 先關清單，清單已關且輸入框有字才清空，兩者都不是就不處理（外層可據此收起搜尋列）；Tab 關閉清單但不攔截。
 * - 鍵盤移動選取時高亮立即切換，不做動畫（呼叫端不要對 active 加 transition）。
 */

export interface ComboState {
  open: boolean;
  active: number;
}

export interface ComboContext {
  /** 可選項目數（候選 + 查看全部）；清單沒有任何項目時為 0。 */
  count: number;
  /** 輸入框目前的字。 */
  value: string;
}

export interface ComboKeyResult {
  state: ComboState;
  /** true＝呼叫端要 preventDefault（鍵已被元件處理）。 */
  handled: boolean;
  /** 進入目前選中的項目（active 指向的那列）。 */
  select: boolean;
  /** 清空輸入框。 */
  clear: boolean;
}

export const COMBO_CLOSED: ComboState = { open: false, active: -1 };

const unhandled = (state: ComboState): ComboKeyResult => ({ state, handled: false, select: false, clear: false });

export function comboKeyDown(state: ComboState, key: string, ctx: ComboContext): ComboKeyResult {
  switch (key) {
    case "ArrowDown": {
      if (ctx.count <= 0) return unhandled(state);
      const active = !state.open || state.active < 0 ? 0 : (state.active + 1) % ctx.count;
      return { state: { open: true, active }, handled: true, select: false, clear: false };
    }
    case "ArrowUp": {
      if (ctx.count <= 0) return unhandled(state);
      const active = !state.open || state.active <= 0 ? ctx.count - 1 : state.active - 1;
      return { state: { open: true, active }, handled: true, select: false, clear: false };
    }
    case "Enter":
      if (state.open && state.active >= 0 && state.active < ctx.count) return { state, handled: true, select: true, clear: false };
      return unhandled(state);
    case "Escape":
      if (state.open) return { state: COMBO_CLOSED, handled: true, select: false, clear: false };
      if (ctx.value !== "") return { state: COMBO_CLOSED, handled: true, select: false, clear: true };
      return unhandled(state);
    case "Tab":
      return unhandled(state.open ? COMBO_CLOSED : state);
    default:
      return unhandled(state);
  }
}

/**
 * 「這次點擊是不是直接點在空白背景上」的判定。背景 canvas 在內容下層、不蓋任何東西（pointer-events: none），
 * 所以用事件的 target 判斷：target 本身與所有祖先（html／body 除外）都沒有實色背景／圖片／毛玻璃，
 * 本身不是可互動元件或媒體，也沒有直接的文字節點 → 視為空白背景，才把點擊交給背景裡的符號。
 */

export interface NodeInfo {
  tag: string;
  parent: NodeInfo | null;
  /** 有非空白的直接文字節點。 */
  hasOwnText: boolean;
  /** 本身或祖先是連結、按鈕、表單元件、可聚焦元件、可編輯區。 */
  interactive: boolean;
  /** 有實色背景、背景圖或 backdrop-filter。 */
  opaque: boolean;
}

const MEDIA_TAGS = new Set(["IMG", "SVG", "VIDEO", "CANVAS", "PICTURE", "IFRAME", "INPUT", "SELECT", "TEXTAREA", "BUTTON", "A", "LABEL", "OBJECT"]);

export function isBackgroundTarget(node: NodeInfo | null): boolean {
  if (!node) return false;
  const tag = node.tag.toUpperCase();
  if (tag === "HTML" || tag === "BODY") return true;
  if (node.interactive || node.hasOwnText || MEDIA_TAGS.has(tag)) return false;
  for (let n: NodeInfo | null = node; n; n = n.parent) {
    const t = n.tag.toUpperCase();
    if (t === "HTML" || t === "BODY") break;
    if (n.opaque) return false;
  }
  return true;
}

const INTERACTIVE_SELECTOR =
  'a[href],button,input,select,textarea,label,summary,[role="button"],[role="link"],[role="menuitem"],[role="option"],[contenteditable="true"],[tabindex]:not([tabindex="-1"])';

function isTransparent(color: string): boolean {
  if (color === "transparent") return true;
  const m = /^rgba?\(([^)]+)\)$/.exec(color.trim());
  if (!m) return false;
  const parts = m[1]!.split(/[,/\s]+/).filter(Boolean);
  return parts.length >= 4 && Number(parts[3]) === 0;
}

/** 從 DOM 元素建立 NodeInfo（只在 pointerdown 時呼叫，成本可忽略）。 */
export function nodeInfoFromElement(el: Element | null, getStyle: (e: Element) => CSSStyleDeclaration = (e) => getComputedStyle(e)): NodeInfo | null {
  if (!el) return null;
  const style = getStyle(el);
  let hasOwnText = false;
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 3 && (c.textContent ?? "").trim() !== "") {
      hasOwnText = true;
      break;
    }
  }
  const opaque =
    !isTransparent(style.backgroundColor) ||
    (style.backgroundImage !== "" && style.backgroundImage !== "none") ||
    (style.backdropFilter !== "" && style.backdropFilter !== "none");
  const parentEl = el.parentElement;
  return {
    tag: el.tagName,
    parent: parentEl ? nodeInfoFromElement(parentEl, getStyle) : null,
    hasOwnText,
    interactive: !!el.closest(INTERACTIVE_SELECTOR),
    opaque,
  };
}

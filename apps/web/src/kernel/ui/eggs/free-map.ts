/**
 * 背景符號的「可出現區域」地圖：把視窗切成 CELL px 的格子，標出哪些格子是空白背景。
 * - 寬螢幕（內容欄左右各至少 WIDE_MARGIN px 留白）：只有內容欄（`main`）以外的兩側留白算空白，
 *   且要離內容欄邊緣至少 EDGE_GAP（符號半徑）。
 * - 窄螢幕（內容欄接近視窗寬、手機）：只有 hit test 判定為空白背景（bg-target.ts）的格子算空白。
 * - 頁首（header）範圍內一律不算。
 * 純資料結構＋一個讀 DOM 的 computeFreeMap（用 elementFromPoint；同一次計算內以 Map 快取每個元素的判定）。
 */
import { isBackgroundTarget, nodeInfoFromElement } from "./bg-target";

export const FREE_CELL = 24;
export const WIDE_MARGIN = 80;
export const EDGE_GAP = 24;

export interface FreeMap {
  cell: number;
  cols: number;
  rows: number;
  free: Uint8Array;
  /** true＝寬螢幕模式（符號只在內容欄兩側）。 */
  wide: boolean;
  width: number;
  height: number;
}

export function emptyFreeMap(width: number, height: number): FreeMap {
  const cols = Math.max(1, Math.ceil(width / FREE_CELL));
  const rows = Math.max(1, Math.ceil(height / FREE_CELL));
  return { cell: FREE_CELL, cols, rows, free: new Uint8Array(cols * rows), wide: false, width, height };
}

export function isFreeAt(map: FreeMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const c = Math.floor(x / map.cell);
  const r = Math.floor(y / map.cell);
  return map.free[r * map.cols + c] === 1;
}

/** 純函式：由「內容欄左右邊界、頁首底邊、每格是否空白」建地圖（單元測試用）。 */
export function buildFreeMap(
  width: number,
  height: number,
  opts: { colLeft: number | null; colRight: number | null; headerBottom: number; blank: (x: number, y: number) => boolean },
): FreeMap {
  const map = emptyFreeMap(width, height);
  const { colLeft, colRight } = opts;
  map.wide = colLeft !== null && colRight !== null && Math.min(colLeft, width - colRight) >= WIDE_MARGIN;
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      const x = c * map.cell + map.cell / 2;
      const y = r * map.cell + map.cell / 2;
      if (x >= width || y >= height) continue;
      if (y < opts.headerBottom + 8) continue;
      if (map.wide && !(x <= colLeft! - EDGE_GAP || x >= colRight! + EDGE_GAP)) continue;
      if (opts.blank(x, y)) map.free[r * map.cols + c] = 1;
    }
  }
  return map;
}

/** 讀 DOM 計算目前視窗的地圖（只在 client、頁面可見時呼叫）。 */
export function computeFreeMap(): FreeMap {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const header = document.querySelector(".site-header")?.getBoundingClientRect();
  const main = document.querySelector("main")?.getBoundingClientRect();
  const cache = new Map<Element, boolean>();
  const blank = (x: number, y: number): boolean => {
    const el = document.elementFromPoint(x, y);
    if (!el) return false;
    let v = cache.get(el);
    if (v === undefined) {
      v = isBackgroundTarget(nodeInfoFromElement(el));
      cache.set(el, v);
    }
    return v;
  };
  return buildFreeMap(w, h, {
    colLeft: main ? main.left : null,
    colRight: main ? main.right : null,
    headerBottom: header ? Math.max(0, header.bottom) : 0,
    blank,
  });
}

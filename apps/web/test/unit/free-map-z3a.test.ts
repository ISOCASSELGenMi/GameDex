import { describe, expect, it } from "vitest";
import { FREE_CELL, WIDE_MARGIN, buildFreeMap, isFreeAt } from "@/kernel/ui/eggs/free-map";

const allBlank = () => true;

describe("背景可出現區域（free-map）", () => {
  it("寬螢幕：只有內容欄兩側留白算空白，離欄緣至少 EDGE_GAP；頁首內不算", () => {
    const m = buildFreeMap(1900, 900, { colLeft: 182, colRight: 1718, headerBottom: 58, blank: allBlank });
    expect(m.wide).toBe(true);
    expect(isFreeAt(m, 40, 400)).toBe(true);
    expect(isFreeAt(m, 1850, 400)).toBe(true);
    expect(isFreeAt(m, 960, 400)).toBe(false); // 內容欄中央
    expect(isFreeAt(m, 175, 400)).toBe(false); // 太靠近欄緣
    expect(isFreeAt(m, 40, 20)).toBe(false); // 頁首
    expect(isFreeAt(m, 40, 58 + 8 + FREE_CELL)).toBe(true);
  });
  it("窄螢幕（欄寬接近視窗寬）：不看欄，只看 hit test 空白；頁首內不算", () => {
    const blank = (x: number) => x > 300; // 左側 300px 有內容
    const m = buildFreeMap(375, 760, { colLeft: 0, colRight: 375, headerBottom: 120, blank });
    expect(m.wide).toBe(false);
    expect(isFreeAt(m, 340, 400)).toBe(true);
    expect(isFreeAt(m, 100, 400)).toBe(false);
    expect(isFreeAt(m, 340, 60)).toBe(false);
  });
  it("留白小於 WIDE_MARGIN 不算寬螢幕；沒有 main 時也不算", () => {
    expect(buildFreeMap(1280, 800, { colLeft: WIDE_MARGIN - 1, colRight: 1280 - WIDE_MARGIN + 1, headerBottom: 0, blank: allBlank }).wide).toBe(false);
    expect(buildFreeMap(1280, 800, { colLeft: null, colRight: null, headerBottom: 0, blank: allBlank }).wide).toBe(false);
    expect(buildFreeMap(1280, 800, { colLeft: WIDE_MARGIN, colRight: 1280 - WIDE_MARGIN, headerBottom: 0, blank: allBlank }).wide).toBe(true);
  });
  it("視窗外座標一律不算", () => {
    const m = buildFreeMap(300, 300, { colLeft: null, colRight: null, headerBottom: 0, blank: allBlank });
    expect(isFreeAt(m, -1, 10)).toBe(false);
    expect(isFreeAt(m, 10, 300)).toBe(false);
  });
});

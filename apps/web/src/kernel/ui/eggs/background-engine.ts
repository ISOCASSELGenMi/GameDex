/**
 * 互動背景引擎（canvas，無 React）：手把按鍵符號漂浮、游標推開、點破成像素粒子、重生、蘑菇頭拖曳、收集物、閒置聚成手把。
 * - 限幀 30fps、粒子上限 MAX_PARTICLES、符號 13～22 顆；只畫 transform 級的簡單向量，不用模糊濾鏡。
 * - reducedMotion：不跑動畫迴圈（靜止排列）、不產生粒子、不做位移；點擊／拖曳仍可用，變更時重畫一次。
 * - 這個檔案只負責「模擬與繪製」；彩蛋的判定（序列、波動拳…）由呼叫端用 logic.ts 處理。
 */
import { ALL_SYMBOL_KINDS, BUTTON_KINDS, DPAD_KINDS, SHAPE_KINDS, STICK_KIND, quantizeStick, type StickDir, type SymbolKind } from "./logic";
import type { UnlockCollectibleKey } from "../unlocks";
import { isFreeAt, type FreeMap } from "./free-map";

export const FRAME_MS = 1000 / 30;
export const MAX_PARTICLES = 160;
export const PARTICLE_LIFE_MS = 560;
const PUSH_RADIUS = 130;
/** 寬螢幕（內容欄兩側）／窄螢幕／手機的符號透明度；閒置聚集時加亮。 */
const SYMBOL_ALPHA = 0.17;
const NARROW_ALPHA = 0.09;
const PHONE_ALPHA = 0.07;
const GATHER_ALPHA = 0.3;

interface Sym {
  id: number;
  kind: SymbolKind;
  size: number;
  rot: number;
  vr: number;
  /** 錨點（空白格內的位置；閒置聚集時是彈簧狀態）與速度。 */
  ax: number;
  ay: number;
  avx: number;
  avy: number;
  /** 目前畫出的位置（錨點＋游標推開偏移＋緩慢漂浮）。 */
  x: number;
  y: number;
  /** 游標推開的偏移與速度（彈簧拉回錨點）。 */
  ox: number;
  oy: number;
  ovx: number;
  ovy: number;
  /** 漂浮的頻率與相位。 */
  w1: number;
  w2: number;
  p1: number;
  p2: number;
  /** 可見度 0..1（淡入淡出；< 0.5 不可點）。 */
  vis: number;
  alive: boolean;
  respawnAt: number;
  hasAnchor: boolean;
  needAnchor: boolean;
  /** 測試／固定排版：不隨地圖重新錨定、不漂浮。 */
  pinned: boolean;
  /** 蘑菇頭的旋鈕位移（相對底座中心）。 */
  knobX: number;
  knobY: number;
  /** 閒置聚集時的目標點。 */
  tx?: number;
  ty?: number;
}

export interface SnapshotItem {
  kind: SymbolKind | UnlockCollectibleKey;
  x: number;
  y: number;
  alive: boolean;
  visible: boolean;
  ax: number;
  ay: number;
  collectible?: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  size: number;
  gold: boolean;
}

interface Collectible {
  key: UnlockCollectibleKey;
  ax: number;
  ay: number;
  x: number;
  y: number;
  size: number;
  vis: number;
  hasAnchor: boolean;
  pinned: boolean;
  w1: number;
  w2: number;
}

export interface FieldCallbacks {
  /** 一顆符號被點破。 */
  onBreak(kind: SymbolKind): void;
  /** 收集物被點到。 */
  onCollect(key: UnlockCollectibleKey): void;
  /** 蘑菇頭拖曳中的方向（null＝回中）。 */
  onStick(dir: StickDir | null, now: number): void;
  /** 閒置聚集狀態下被點到。 */
  onGatherClick(): void;
}

export interface FieldOptions {
  canvas: HTMLCanvasElement;
  callbacks: FieldCallbacks;
  reducedMotion: boolean;
  /** 讀目前主題的前景色（CSS 色字串）。 */
  readColor(): string;
}

/** 手把輪廓（相對中心的 -1..1 座標），閒置聚集時符號依序排上去。 */
const GAMEPAD_POINTS: readonly (readonly [number, number])[] = [
  [-0.55, -0.35],
  [-0.2, -0.4],
  [0.2, -0.4],
  [0.55, -0.35],
  [0.85, -0.2],
  [1.0, 0.15],
  [0.98, 0.5],
  [0.8, 0.62],
  [0.6, 0.4],
  [0.35, 0.22],
  [0, 0.2],
  [-0.35, 0.22],
  [-0.6, 0.4],
  [-0.8, 0.62],
  [-0.98, 0.5],
  [-1.0, 0.15],
  [-0.85, -0.2],
  [-0.55, 0.0],
  [0.55, 0.0],
  [-0.2, 0.0],
  [0.2, 0.0],
  [0, -0.2],
];

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export class BackgroundField {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cb: FieldCallbacks;
  private readonly reduced: boolean;
  private readonly readColor: () => string;
  private color = "#888";
  private w = 0;
  private h = 0;
  private dpr = 1;
  private syms: Sym[] = [];
  private particles: Particle[] = [];
  private collectible: Collectible | null = null;
  private map: FreeMap | null = null;
  private good: number[] = [];
  private nextId = 1;
  private px = -9999;
  private py = -9999;
  private raf = 0;
  private lastTick = 0;
  private lastDraw = 0;
  private drawCount = 0;
  private running = false;
  private gathered = false;
  private gatherCenter = { x: 0, y: 0, r: 0 };
  private dragging: { sym: Sym; pointerId: number; startX: number; startY: number; moved: boolean } | null = null;
  private respawnTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(opts: FieldOptions) {
    this.canvas = opts.canvas;
    const ctx = opts.canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d unavailable");
    this.ctx = ctx;
    this.cb = opts.callbacks;
    this.reduced = opts.reducedMotion;
    this.readColor = opts.readColor;
  }

  // ── 生命週期 ──────────────────────────────────────────────

  resize(width: number, height: number, dpr: number): void {
    this.w = Math.max(1, Math.floor(width));
    this.h = Math.max(1, Math.floor(height));
    this.dpr = Math.min(2, Math.max(1, dpr));
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    if (this.syms.length === 0) for (const kind of ALL_SYMBOL_KINDS) this.syms.push(this.makeSym(kind));
    this.refreshColor();
    this.settle();
  }

  refreshColor(): void {
    this.color = this.readColor() || "#888";
    this.redraw();
  }

  start(): void {
    if (this.reduced || this.running) return;
    this.running = true;
    this.lastTick = performance.now();
    const loop = (t: number): void => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      if (t - this.lastDraw < FRAME_MS) return;
      const dt = Math.min(0.05, (t - this.lastTick) / 1000);
      this.lastTick = t;
      this.lastDraw = t;
      this.update(dt, t);
      this.draw(t);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  destroy(): void {
    this.stop();
    for (const t of this.respawnTimers) clearTimeout(t);
    this.respawnTimers.clear();
  }

  // ── 可出現區域（free-map）與錨點 ─────────────────────────────

  /** 設定可出現區域；符號的錨點格不再空白就淡出並重新錨定。 */
  setFreeMap(map: FreeMap): void {
    this.map = map;
    this.good = [];
    const { cols, rows, free } = map;
    const loose: number[] = [];
    const medium: number[] = [];
    const strict: number[] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (!free[i]) continue;
        loose.push(i);
        let n = 0;
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && free[rr * cols + cc]) n++;
          }
        if (n >= 5) medium.push(i);
        if (n >= 8) strict.push(i);
      }
    // 窄螢幕／手機優先挑「周圍整圈都空白」的格子（符號不壓到內容）；不夠再放寬
    this.good = map.wide ? (medium.length ? medium : loose) : strict.length >= 6 ? strict : medium.length ? medium : loose;
    // 寬螢幕：依可用面積補重複符號（0～9 顆）；窄螢幕只留 13 顆必要符號
    const wantExtra = map.wide ? Math.min(9, Math.floor(this.good.length / 40)) : 0;
    const extras = this.syms.length - ALL_SYMBOL_KINDS.length;
    if (extras > wantExtra) this.syms.length = ALL_SYMBOL_KINDS.length + wantExtra;
    const pool: SymbolKind[] = [...SHAPE_KINDS, ...BUTTON_KINDS, ...DPAD_KINDS];
    for (let i = Math.max(0, extras); i < wantExtra; i++) this.syms.push(this.makeSym(pool[i % pool.length]!));
    this.settle();
  }

  private get baseAlpha(): number {
    if (this.gathered) return GATHER_ALPHA;
    if (this.map?.wide) return SYMBOL_ALPHA;
    return this.w < 640 ? PHONE_ALPHA : NARROW_ALPHA;
  }

  private anchorValid(x: number, y: number): boolean {
    return !!this.map && isFreeAt(this.map, x, y);
  }

  private pickAnchor(self: Sym | null): { x: number; y: number } | null {
    const m = this.map;
    if (!m || this.good.length === 0) return null;
    let best: { x: number; y: number } | null = null;
    let bestD = -1;
    for (let k = 0; k < 8; k++) {
      const i = this.good[Math.floor(Math.random() * this.good.length)]!;
      const x = (i % m.cols) * m.cell + m.cell / 2 + rand(-6, 6);
      const y = Math.floor(i / m.cols) * m.cell + m.cell / 2 + rand(-6, 6);
      let d = Infinity;
      for (const o of this.syms) if (o.alive && o.hasAnchor && o !== self) d = Math.min(d, Math.hypot(o.ax - x, o.ay - y));
      if (d > bestD) {
        bestD = d;
        best = { x, y };
      }
      if (d >= 56) break;
    }
    return best;
  }

  /** 靜止（reduced-motion）或地圖／狀態改變時：檢查錨點有效性、補錨點、同步位置與可見度（動畫迴圈執行中由 update 處理）。 */
  private settle(): void {
    if (this.running) return;
    for (const s of this.syms) {
      if (s.pinned || this.gathered) {
        s.vis = s.alive ? 1 : 0;
        continue;
      }
      if (s.hasAnchor && !this.anchorValid(s.ax, s.ay)) {
        s.hasAnchor = false;
        s.needAnchor = true;
      }
      if (s.alive && s.needAnchor) this.assign(s);
      s.vis = s.alive && s.hasAnchor ? 1 : 0;
      s.x = s.ax;
      s.y = s.ay;
    }
    const c = this.collectible;
    if (c) {
      if (!c.pinned && c.hasAnchor && !this.anchorValid(c.ax, c.ay)) c.hasAnchor = false;
      if (!c.hasAnchor) this.assignCollectible(c);
      c.vis = c.hasAnchor ? 1 : 0;
      c.x = c.ax;
      c.y = c.ay;
    }
    this.redraw();
  }

  private assign(s: Sym): void {
    const p = this.pickAnchor(s);
    if (!p) return;
    s.ax = p.x;
    s.ay = p.y;
    s.avx = s.avy = 0;
    s.x = p.x;
    s.y = p.y;
    s.ox = s.oy = s.ovx = s.ovy = 0;
    s.hasAnchor = true;
    s.needAnchor = false;
  }

  private assignCollectible(c: Collectible): void {
    const p = this.pickAnchor(null);
    if (!p) return;
    c.ax = c.x = p.x;
    c.ay = c.y = p.y;
    c.hasAnchor = true;
  }

  // ── 狀態 ──────────────────────────────────────────────────

  private makeSym(kind: SymbolKind): Sym {
    return {
      id: this.nextId++,
      kind,
      size: kind === STICK_KIND ? rand(40, 50) : rand(26, 40),
      rot: rand(-0.4, 0.4),
      vr: rand(-0.12, 0.12),
      ax: -999,
      ay: -999,
      avx: 0,
      avy: 0,
      x: -999,
      y: -999,
      ox: 0,
      oy: 0,
      ovx: 0,
      ovy: 0,
      w1: rand(0.25, 0.5),
      w2: rand(0.2, 0.45),
      p1: rand(0, 6.28),
      p2: rand(0, 6.28),
      vis: 0,
      alive: true,
      respawnAt: 0,
      hasAnchor: false,
      needAnchor: true,
      pinned: false,
      knobX: 0,
      knobY: 0,
    };
  }

  /** 供測試掛鉤與除錯：目前所有符號（visible＝可見且可點）。 */
  snapshot(): SnapshotItem[] {
    const out: SnapshotItem[] = this.syms.map((s) => ({
      kind: s.kind,
      x: s.x,
      y: s.y,
      alive: s.alive,
      visible: s.alive && s.vis >= 0.5,
      ax: s.ax,
      ay: s.ay,
    }));
    const c = this.collectible;
    if (c) out.push({ kind: c.key, x: c.x, y: c.y, alive: true, visible: c.vis >= 0.5, ax: c.ax, ay: c.ay, collectible: true });
    return out;
  }

  /** 目前的地圖模式（測試用）。 */
  get mode(): { wide: boolean; alpha: number; symbols: number } {
    return { wide: !!this.map?.wide, alpha: this.baseAlpha, symbols: this.syms.length };
  }

  /** 測試／固定排版用：把某種符號放到指定位置（固定、立刻可見、不隨地圖重新錨定）。 */
  place(kind: SymbolKind | "collectible", x: number, y: number): boolean {
    if (kind === "collectible") {
      const c = this.collectible;
      if (!c) return false;
      c.ax = c.x = x;
      c.ay = c.y = y;
      c.hasAnchor = true;
      c.pinned = true;
      c.vis = 1;
      this.redraw();
      return true;
    }
    const s = this.syms.find((v) => v.kind === kind) ?? null;
    if (!s) return false;
    s.alive = true;
    s.pinned = true;
    s.hasAnchor = true;
    s.needAnchor = false;
    s.ax = s.x = x;
    s.ay = s.y = y;
    s.avx = s.avy = s.ox = s.oy = s.ovx = s.ovy = 0;
    s.vis = 1;
    this.redraw();
    return true;
  }

  setCollectible(key: UnlockCollectibleKey | null): void {
    if (!key) this.collectible = null;
    else {
      this.collectible = { key, ax: -999, ay: -999, x: -999, y: -999, size: 40, vis: 0, hasAnchor: false, pinned: false, w1: 0.31, w2: 0.23 };
    }
    this.settle();
  }

  setGather(on: boolean): void {
    if (this.gathered === on) return;
    this.gathered = on;
    if (on) {
      const scale = Math.max(80, Math.min(this.w, this.h) * 0.3);
      const c = this.bestGatherCenter(scale * 1.25);
      this.gatherCenter = { x: c.x, y: c.y, r: scale * 1.25 };
      let i = 0;
      for (const s of this.syms) {
        if (!s.alive || s === this.dragging?.sym) continue;
        const [nx, ny] = GAMEPAD_POINTS[i % GAMEPAD_POINTS.length]!;
        s.tx = c.x + nx * scale * 1.15;
        s.ty = c.y + ny * scale * 0.8;
        s.pinned = false;
        i++;
      }
      if (this.reduced) {
        for (const s of this.syms)
          if (s.alive && s.tx !== undefined) {
            s.ax = s.x = s.tx;
            s.ay = s.y = s.ty!;
            s.vis = 1;
          }
      }
    } else {
      for (const s of this.syms) {
        s.tx = undefined;
        s.ty = undefined;
        s.avx = rand(-120, 120);
        s.avy = rand(-120, 120);
        s.needAnchor = true;
        s.hasAnchor = false;
      }
      this.settle();
    }
    this.redraw();
  }

  /** 空白格最密的區域中心（聚集的手把要出現在可點的空白處）；沒有地圖就用畫面中心。 */
  private bestGatherCenter(radius: number): { x: number; y: number } {
    const m = this.map;
    const fallback = { x: this.w / 2, y: this.h / 2 };
    if (!m) return fallback;
    const rc = Math.max(2, Math.round(radius / m.cell));
    let best = fallback;
    let bestScore = -1;
    for (let r = 0; r < m.rows; r += 3)
      for (let c = 0; c < m.cols; c += 3) {
        let score = 0;
        for (let dr = -rc; dr <= rc; dr += 2)
          for (let dc = -rc; dc <= rc; dc += 2) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr >= 0 && rr < m.rows && cc >= 0 && cc < m.cols && m.free[rr * m.cols + cc]) score++;
          }
        const x = c * m.cell + m.cell / 2;
        const y = r * m.cell + m.cell / 2;
        const tie = -Math.hypot(x - this.w / 2, y - this.h / 2) / 100000;
        if (score + tie > bestScore) {
          bestScore = score + tie;
          best = { x, y };
        }
      }
    return bestScore > 0 ? best : fallback;
  }

  /** 測試用：把「聚集的手把」的點擊範圍移到指定位置。 */
  setGatherCenter(x: number, y: number): void {
    this.gatherCenter = { ...this.gatherCenter, x, y };
  }

  /** 已繪製的幀數（測試用：驗證分頁隱藏時停止）。 */
  get frames(): number {
    return this.drawCount;
  }

  get isGathered(): boolean {
    return this.gathered;
  }

  // ── 指標 ──────────────────────────────────────────────────

  pointerMove(x: number, y: number, now: number): void {
    this.px = x;
    this.py = y;
    const d = this.dragging;
    if (d) {
      const max = d.sym.size * 0.9;
      let dx = x - d.sym.x;
      let dy = y - d.sym.y;
      const len = Math.hypot(dx, dy);
      if (len > max) {
        dx = (dx / len) * max;
        dy = (dy / len) * max;
      }
      d.sym.knobX = dx;
      d.sym.knobY = dy;
      if (Math.hypot(x - d.startX, y - d.startY) > 6) d.moved = true;
      this.cb.onStick(quantizeStick(dx, dy, max), now);
      if (this.reduced) this.redraw();
    }
  }

  pointerLeave(): void {
    this.px = this.py = -9999;
  }

  /** 回傳 true＝這次點擊打到了背景裡的東西（符號、收集物、聚集的手把、蘑菇頭）。 */
  pointerDown(x: number, y: number, pointerId: number, now: number): boolean {
    this.px = x;
    this.py = y;
    const c = this.collectible;
    if (c && c.vis >= 0.5 && Math.hypot(x - c.x, y - c.y) <= c.size * 0.9) {
      this.collectible = null;
      this.burst(c.x, c.y, 16, true, now);
      this.redraw();
      this.cb.onCollect(c.key);
      return true;
    }
    const hit = this.hitSym(x, y);
    if (this.gathered) {
      const g = this.gatherCenter;
      if (hit || Math.hypot(x - g.x, y - g.y) <= g.r) {
        this.cb.onGatherClick();
        return true;
      }
      return false;
    }
    if (!hit) return false;
    if (hit.kind === STICK_KIND) {
      this.dragging = { sym: hit, pointerId, startX: x, startY: y, moved: false };
      hit.ovx = hit.ovy = 0;
      return true;
    }
    this.breakSym(hit, now);
    return true;
  }

  pointerUp(pointerId: number, now: number): void {
    const d = this.dragging;
    if (!d || d.pointerId !== pointerId) return;
    this.dragging = null;
    this.cb.onStick(null, now);
    if (this.reduced) {
      d.sym.knobX = d.sym.knobY = 0;
      this.redraw();
    }
  }

  /** 目前是否正在拖曳蘑菇頭（呼叫端用來決定是否 preventDefault 觸控捲動）。 */
  get isDragging(): boolean {
    return this.dragging !== null;
  }

  /** 這個座標是否落在蘑菇頭上（觸控開始時用來決定要不要阻止捲動）。 */
  overStick(x: number, y: number): boolean {
    const s = this.hitSym(x, y);
    return !!s && s.kind === STICK_KIND && !this.gathered;
  }

  private hitSym(x: number, y: number): Sym | null {
    let best: Sym | null = null;
    let bestD = Infinity;
    for (const s of this.syms) {
      if (!s.alive || s.vis < 0.5) continue;
      const d = Math.hypot(x - s.x, y - s.y);
      const reach = s.size * 0.72 + 6;
      if (d <= reach && d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  // ── 破壞與重生 ────────────────────────────────────────────

  private breakSym(s: Sym, now: number): void {
    s.alive = false;
    s.respawnAt = now + rand(2500, 4200);
    this.burst(s.x, s.y, 12, false, now);
    this.cb.onBreak(s.kind);
    if (this.reduced) {
      this.redraw();
      const t = setTimeout(() => {
        this.respawnTimers.delete(t);
        this.revive(s);
        this.settle();
      }, s.respawnAt - now);
      this.respawnTimers.add(t);
    }
  }

  private revive(s: Sym): void {
    s.alive = true;
    s.pinned = false;
    s.vis = 0;
    s.hasAnchor = false;
    s.needAnchor = true;
  }

  private burst(x: number, y: number, n: number, gold: boolean, now: number): void {
    if (this.reduced) return;
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(60, 200);
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, born: now, size: Math.random() < 0.4 ? 5 : 3, gold });
    }
  }

  // ── 模擬 ──────────────────────────────────────────────────

  private update(dt: number, now: number): void {
    const t = now / 1000;
    const amp = this.map?.wide ? 24 : 10;
    for (const s of this.syms) {
      if (!s.alive) {
        if (now >= s.respawnAt) this.revive(s);
        continue;
      }
      // 錨點失效（捲動、換版面）→ 淡出，淡完再重新錨定
      if (!s.pinned && !this.gathered && s.hasAnchor && Math.hypot(s.avx, s.avy) < 5 && !this.anchorValid(s.ax, s.ay)) {
        s.hasAnchor = false;
        s.needAnchor = true;
      }
      if (s.needAnchor && s.vis <= 0.03 && !this.gathered) this.assign(s);
      const target = this.gathered || s.pinned || (s.hasAnchor && !s.needAnchor) ? 1 : 0;
      s.vis += Math.max(-dt / 0.3, Math.min(dt / 0.35, target - s.vis));
      if (this.dragging?.sym === s) continue;
      if (s.kind === STICK_KIND && (s.knobX !== 0 || s.knobY !== 0)) {
        const k = Math.exp(-dt * 14);
        s.knobX *= k;
        s.knobY *= k;
        if (Math.hypot(s.knobX, s.knobY) < 0.3) s.knobX = s.knobY = 0;
      }
      if (this.gathered && s.tx !== undefined) {
        // 彈簧拉向目標點（有慣性、略帶過衝）
        s.avx += (s.tx - s.ax) * 9 * dt;
        s.avy += (s.ty! - s.ay) * 9 * dt;
        const damp = Math.exp(-dt * 5);
        s.avx *= damp;
        s.avy *= damp;
      } else {
        s.avx *= Math.exp(-dt * 3);
        s.avy *= Math.exp(-dt * 3);
        if (!this.gathered && s.vis > 0.3) {
          const dx = s.x - this.px;
          const dy = s.y - this.py;
          const d = Math.hypot(dx, dy);
          if (d < PUSH_RADIUS && d > 0.01) {
            const f = (1 - d / PUSH_RADIUS) ** 2 * 1400 * dt;
            s.ovx += (dx / d) * f;
            s.ovy += (dy / d) * f;
          }
        }
      }
      // 游標推開的偏移：彈簧拉回錨點＋阻尼（有慣性）
      s.ovx += -5 * s.ox * dt;
      s.ovy += -5 * s.oy * dt;
      const od = Math.exp(-dt * 5);
      s.ovx *= od;
      s.ovy *= od;
      s.ox += s.ovx * dt;
      s.oy += s.ovy * dt;
      s.ax += s.avx * dt;
      s.ay += s.avy * dt;
      const wob = s.pinned || this.gathered ? 0 : amp;
      s.x = s.ax + s.ox + wob * Math.sin(t * s.w1 + s.p1);
      s.y = s.ay + s.oy + wob * Math.cos(t * s.w2 + s.p2);
      s.rot += s.vr * dt;
    }
    const c = this.collectible;
    if (c) {
      if (!c.pinned && c.hasAnchor && !this.anchorValid(c.ax, c.ay)) c.hasAnchor = false;
      if (!c.hasAnchor && !c.pinned) this.assignCollectible(c);
      c.vis += Math.max(-dt / 0.3, Math.min(dt / 0.35, (c.hasAnchor || c.pinned ? 1 : 0) - c.vis));
      const wob = c.pinned ? 0 : 20;
      c.x = c.ax + wob * Math.sin(t * c.w1);
      c.y = c.ay + wob * Math.cos(t * c.w2);
    }
    if (this.particles.length) {
      this.particles = this.particles.filter((p) => now - p.born < PARTICLE_LIFE_MS);
      for (const p of this.particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= Math.exp(-dt * 3);
        p.vy *= Math.exp(-dt * 3);
      }
    }
  }


  // ── 繪製 ──────────────────────────────────────────────────

  redraw(): void {
    if (!this.running) this.draw(performance.now());
  }

  private draw(now: number): void {
    this.drawCount++;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.strokeStyle = this.color;
    ctx.fillStyle = this.color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of this.syms) {
      if (!s.alive || s.vis < 0.02) continue;
      ctx.globalAlpha = this.baseAlpha * s.vis;
      this.drawSymbol(ctx, s);
    }
    if (this.particles.length) {
      for (const p of this.particles) {
        const k = 1 - (now - p.born) / PARTICLE_LIFE_MS;
        ctx.globalAlpha = Math.max(0, k) * (p.gold ? 0.9 : 0.4);
        ctx.fillStyle = p.gold ? "#f5b400" : this.color;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      }
    }
    if (this.collectible && this.collectible.vis >= 0.02) this.drawCollectible(ctx, this.collectible, now);
    ctx.globalAlpha = 1;
  }

  private drawSymbol(ctx: CanvasRenderingContext2D, s: Sym): void {
    const r = s.size / 2;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    ctx.beginPath();
    switch (s.kind) {
      case "triangle":
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.95, r * 0.75);
        ctx.lineTo(-r * 0.95, r * 0.75);
        ctx.closePath();
        ctx.stroke();
        break;
      case "circle":
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case "cross":
        ctx.moveTo(-r * 0.8, -r * 0.8);
        ctx.lineTo(r * 0.8, r * 0.8);
        ctx.moveTo(r * 0.8, -r * 0.8);
        ctx.lineTo(-r * 0.8, r * 0.8);
        ctx.stroke();
        break;
      case "square":
        ctx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
        ctx.stroke();
        break;
      case "btn-a":
      case "btn-b":
      case "btn-x":
      case "btn-y": {
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.rotate(-s.rot);
        ctx.font = `700 ${Math.round(r * 1.1)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(s.kind.slice(4).toUpperCase(), 0, 1);
        break;
      }
      case "dpad-up":
      case "dpad-down":
      case "dpad-left":
      case "dpad-right": {
        const a = r * 0.36;
        const e = r;
        ctx.moveTo(-a, -e);
        ctx.lineTo(a, -e);
        ctx.lineTo(a, -a);
        ctx.lineTo(e, -a);
        ctx.lineTo(e, a);
        ctx.lineTo(a, a);
        ctx.lineTo(a, e);
        ctx.lineTo(-a, e);
        ctx.lineTo(-a, a);
        ctx.lineTo(-e, a);
        ctx.lineTo(-e, -a);
        ctx.lineTo(-a, -a);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        const arm = s.kind.slice(5);
        if (arm === "up") ctx.rect(-a, -e, a * 2, e - a);
        else if (arm === "down") ctx.rect(-a, a, a * 2, e - a);
        else if (arm === "left") ctx.rect(-e, -a, e - a, a * 2);
        else ctx.rect(a, -a, e - a, a * 2);
        ctx.fill();
        break;
      }
      case "stick": {
        ctx.rotate(-s.rot);
        ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(s.knobX, s.knobY, r * 0.5, 0, Math.PI * 2);
        ctx.globalAlpha *= 1.5;
        ctx.fill();
        break;
      }
    }
    ctx.restore();
  }

  private drawCollectible(ctx: CanvasRenderingContext2D, c: Collectible, now: number): void {
    const pulse = this.reduced ? 1 : 0.85 + 0.15 * Math.sin(now / 320);
    const r = c.size / 2;
    const g = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, r * 1.9);
    g.addColorStop(0, "rgba(255, 204, 51, 0.55)");
    g.addColorStop(1, "rgba(255, 204, 51, 0)");
    ctx.globalAlpha = pulse * c.vis;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * 1.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.95 * c.vis;
    ctx.strokeStyle = "#f5b400";
    ctx.fillStyle = "#f5b400";
    ctx.lineWidth = 2.5;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.beginPath();
    switch (c.key) {
      case "cartridge":
        ctx.rect(-r * 0.7, -r * 0.8, r * 1.4, r * 1.6);
        ctx.moveTo(-r * 0.4, -r * 0.8);
        ctx.lineTo(-r * 0.4, -r * 0.2);
        ctx.lineTo(r * 0.4, -r * 0.2);
        ctx.lineTo(r * 0.4, -r * 0.8);
        ctx.stroke();
        break;
      case "floppy":
        ctx.moveTo(-r * 0.8, -r * 0.8);
        ctx.lineTo(r * 0.5, -r * 0.8);
        ctx.lineTo(r * 0.8, -r * 0.5);
        ctx.lineTo(r * 0.8, r * 0.8);
        ctx.lineTo(-r * 0.8, r * 0.8);
        ctx.closePath();
        ctx.moveTo(-r * 0.4, -r * 0.8);
        ctx.lineTo(-r * 0.4, -r * 0.3);
        ctx.lineTo(r * 0.3, -r * 0.3);
        ctx.lineTo(r * 0.3, -r * 0.8);
        ctx.moveTo(-r * 0.5, r * 0.8);
        ctx.lineTo(-r * 0.5, r * 0.2);
        ctx.lineTo(r * 0.5, r * 0.2);
        ctx.lineTo(r * 0.5, r * 0.8);
        ctx.stroke();
        break;
      case "cd":
      case "dvd":
      case "bluray":
        ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
        ctx.moveTo(r * 0.22, 0);
        ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
        if (c.key !== "cd") {
          ctx.moveTo(r * 0.6, 0);
          ctx.arc(0, 0, r * 0.6, 0, Math.PI * (c.key === "dvd" ? 1.2 : 2));
        }
        ctx.stroke();
        break;
      case "memory-card":
        ctx.moveTo(-r * 0.6, -r * 0.85);
        ctx.lineTo(r * 0.3, -r * 0.85);
        ctx.lineTo(r * 0.6, -r * 0.55);
        ctx.lineTo(r * 0.6, r * 0.85);
        ctx.lineTo(-r * 0.6, r * 0.85);
        ctx.closePath();
        for (let i = -2; i <= 1; i++) {
          ctx.moveTo(i * r * 0.28 + r * 0.14, r * 0.85);
          ctx.lineTo(i * r * 0.28 + r * 0.14, r * 0.45);
        }
        ctx.stroke();
        break;
      case "game-card":
        ctx.moveTo(-r * 0.55, -r * 0.85);
        ctx.lineTo(r * 0.55, -r * 0.85);
        ctx.lineTo(r * 0.55, r * 0.85);
        ctx.lineTo(-r * 0.55, r * 0.85);
        ctx.closePath();
        ctx.moveTo(r * 0.55, -r * 0.55);
        ctx.lineTo(r * 0.3, -r * 0.55);
        ctx.lineTo(r * 0.3, -r * 0.25);
        ctx.lineTo(r * 0.55, -r * 0.25);
        ctx.stroke();
        break;
      case "cloud":
        ctx.moveTo(-r * 0.7, r * 0.5);
        ctx.arc(-r * 0.45, r * 0.1, r * 0.4, Math.PI * 0.5, Math.PI * 1.5);
        ctx.arc(0, -r * 0.2, r * 0.5, Math.PI, Math.PI * 1.9);
        ctx.arc(r * 0.5, r * 0.15, r * 0.4, Math.PI * 1.5, Math.PI * 0.5);
        ctx.closePath();
        ctx.stroke();
        break;
    }
    ctx.restore();
    ctx.strokeStyle = this.color;
    ctx.fillStyle = this.color;
  }
}

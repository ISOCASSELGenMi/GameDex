"use client";
/**
 * 瀏覽頁分組檢視的客戶端互動（頁面其餘都是伺服器元件）：
 * - GroupsProvider：提供 API 網址與文字給各組的「顯示更多」。
 * - GroupCardList：組內卡片清單＋「顯示更多」（按需呼叫 /api/v1/games/group，接在伺服器已送出的卡片後面）。
 * - GroupSwitch：分組切換（radio group）。每個選項帶自己的網址，選取後客戶端導覽（沒有 JS 時由 <noscript> 的連結取代）。
 * 動態只用 transform／opacity；鍵盤操作（Enter／空白鍵／方向鍵）不做動畫。
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { GAME_GROUP_MORE } from "../../../domain/entities/game-groups";
import { GroupCard, type GroupCardData, type GroupMoreResponse } from "./group-card";

export interface GroupsLabels {
  /** 含 {count} */
  more: string;
  loading: string;
  error: string;
  /** 含 {count} */
  loaded: string;
}

interface GroupsContext {
  /** `/api/v1/games/group?locale=…&by=…&<篩選>`（客戶端再接 key、offset、limit）。 */
  endpoint: string;
  labels: GroupsLabels;
}

const Ctx = createContext<GroupsContext | null>(null);

export function GroupsProvider({ endpoint, labels, children }: { endpoint: string; labels: GroupsLabels; children: ReactNode }) {
  return <Ctx.Provider value={{ endpoint, labels }}>{children}</Ctx.Provider>;
}

const fill = (template: string, count: number) => template.replace("{count}", String(count));

/** ref callback：元件接手（水合完成）後在 DOM 上標 data-ready（e2e 等這個再操作；不用 state，避免多一次 render）。 */
const markReady = (el: HTMLElement | null) => {
  if (el) el.dataset.ready = "true";
};

/**
 * 組內卡片清單＋「顯示更多」。首屏卡片以**資料**（compact props）傳進來、由這個元件渲染（伺服器端照樣渲染成 HTML，沒有 JS 也看得到）——
 * 比把伺服器元件的結果當 children 傳少一份 RSC payload（每張卡約省一半位元組），頁面 HTML 才能壓在 200 KB 內。
 */
export function GroupCardList({ groupKey, total, cards }: { groupKey: string; total: number; cards: readonly GroupCardData[] }) {
  const ctx = useContext(Ctx);
  const [extra, setExtra] = useState<GroupCardData[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [announce, setAnnounce] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  // 載入後要把焦點移到第一張新卡片（只在使用者按「顯示更多」之後）
  const focusFrom = useRef<number | null>(null);
  const shown = cards.length;
  const loaded = shown + extra.length;
  const remaining = Math.max(0, total - loaded);

  useEffect(() => {
    if (focusFrom.current === null) return;
    const index = focusFrom.current;
    focusFrom.current = null;
    listRef.current?.querySelectorAll<HTMLAnchorElement>(".rc-card a")[index]?.focus({ preventScroll: false });
  }, [extra.length]);

  const loadMore = useCallback(
    async (instant: boolean) => {
      if (!ctx || busy) return;
      setBusy(true);
      setFailed(false);
      try {
        const res = await fetch(`${ctx.endpoint}&key=${encodeURIComponent(groupKey)}&offset=${loaded}&limit=${GAME_GROUP_MORE}`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as GroupMoreResponse;
        if (body.cards.length === 0) {
          setFailed(true);
          return;
        }
        listRef.current?.toggleAttribute("data-instant", instant);
        focusFrom.current = loaded;
        setExtra((prev) => [...prev, ...body.cards]);
        setAnnounce(fill(ctx.labels.loaded, body.cards.length));
      } catch {
        setFailed(true);
      } finally {
        setBusy(false);
      }
    },
    [ctx, busy, groupKey, loaded],
  );

  return (
    <>
      <ul ref={listRef} className="rc-list">
        {cards.map((c, i) => (
          <GroupCard key={`${c.h}|${i}`} data={c} eager={i < 2} />
        ))}
        {extra.map((c, i) => (
          <GroupCard key={`${c.h}|${shown + i}`} data={c} appended />
        ))}
      </ul>
      {ctx && remaining > 0 ? (
        <button ref={markReady} type="button" className="btn-secondary rc-more" disabled={busy} aria-busy={busy} onClick={(e) => void loadMore(e.detail === 0)} data-rc-more={groupKey}>
          {busy ? ctx.labels.loading : fill(ctx.labels.more, remaining)}
        </button>
      ) : null}
      {failed && ctx ? (
        <p className="rc-error" data-rc-error="">
          {ctx.labels.error}
        </p>
      ) : null}
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
    </>
  );
}

export interface GroupSwitchItem {
  value: string;
  label: string;
  href: string;
}

/** 分組切換（radio group）：選取就導覽到該選項的網址。鍵盤的方向鍵切換也會導覽，所以不另做動畫。 */
export function GroupSwitch({ legend, name, current, items }: { legend: string; name: string; current: string; items: readonly GroupSwitchItem[] }) {
  const router = useRouter();
  // 選取後導覽需要一點時間：先在本地反映選取（受控的 radio 否則會彈回舊值），網址換了以後再與 current 對齊
  const [selected, setSelected] = useState(current);
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    setSelected(current);
  }
  return (
    <fieldset ref={markReady} className="rc-switch" data-rc-switch="">
      <legend className="sr-only">{legend}</legend>
      {items.map((item) => (
        <label key={item.value} className="rc-switch-item">
          <input
            type="radio"
            name={name}
            value={item.value}
            checked={selected === item.value}
            onChange={() => {
              setSelected(item.value);
              router.push(item.href, { scroll: false });
            }}
          />
          <span>{item.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

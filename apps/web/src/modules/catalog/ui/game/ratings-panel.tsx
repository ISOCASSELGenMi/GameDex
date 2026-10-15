"use client";
/**
 * 詳情頁評分區的互動部分（客戶端元件）。
 * 伺服器一律輸出第 1 層（站長）允許的所有來源分數，每列標 `data-score-provider`；沒有 JavaScript 時看到預設來源。
 * 水合後讀 localStorage 的偏好，用同一份 selectRatings（domain/rating-display）重算要顯示哪些列與主分數。
 * 沒有可顯示的分數時（沒有任何評分，或所選來源都沒分數）顯示所選來源的欄位名稱、值空白（「—」＋螢幕閱讀器讀「尚無評分」），
 * 不退回沒選的來源（使用者 2026-10-15 決定）。
 * 不寫 Cookie、不送 Set-Cookie（可快取頁面，06／D60）。偏好只存在這個瀏覽器。
 */
import { useSyncExternalStore, type ReactElement } from "react";
import { selectRatings, type RatingLike } from "../../domain/rating-display";

/** localStorage 鍵（訪客版；登入者版在 accounts，Phase 6/7）。 */
export const SCORE_PROVIDERS_STORAGE_KEY = "sok:scoreProviders";

export interface RatingItem extends RatingLike {
  /** 伺服器已依 locale 組好的整行文字，例如「IGDB 82／100（12 則評論）」。 */
  text: string;
}

export interface RatingsPanelLabels {
  legend: string;
  hint: string;
  /** 空白欄位給螢幕閱讀器讀的文字（「尚無評分」）。 */
  noRatings: string;
}

export interface RatingsPanelProps {
  items: readonly RatingItem[];
  /** 層 1（站長）。 */
  visible: readonly string[];
  /** 層 3（站長）。 */
  priority: readonly string[];
  /** 沒有偏好時的來源（伺服器預設輸出的就是這組）。 */
  defaultSelected: readonly string[];
  /** 可選來源（層 1 之後實際有分數的來源）；少於 2 個不顯示設定 UI。 */
  providers: readonly { id: string; label: string }[];
  /** 站長允許、有欄位可顯示的來源（不論有沒有分數）；偏好與空白欄位以此為準。 */
  fieldProviders: readonly { id: string; label: string }[];
  labels: RatingsPanelLabels;
}

// ── localStorage 當作外部儲存（useSyncExternalStore：伺服器與水合期間讀到「沒有偏好」，水合後換成實際值，不會 hydration 不一致）──
const listeners = new Set<() => void>();
/** 寫入失敗（私密視窗、封鎖儲存）時只在本頁生效。undefined＝尚未寫過。 */
let memorySelection: string | null | undefined;

function subscribe(onChange: () => void): () => void {
  const onStorage = () => {
    memorySelection = undefined; // 別的分頁改了偏好 → 以 localStorage 為準
    onChange();
  };
  listeners.add(onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getStoredRaw(): string | null {
  if (memorySelection !== undefined) return memorySelection;
  try {
    return window.localStorage.getItem(SCORE_PROVIDERS_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredSelection(selected: readonly string[]): void {
  const raw = JSON.stringify(selected);
  memorySelection = raw;
  try {
    window.localStorage.setItem(SCORE_PROVIDERS_STORAGE_KEY, raw);
  } catch {
    // 寫不進去就只在本頁生效
  }
  for (const l of listeners) l();
}

function parseSelection(raw: string | null, allowed: readonly string[]): string[] | undefined {
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((x): x is string => typeof x === "string" && allowed.includes(x));
  } catch {
    return undefined;
  }
}

const noopSubscribe = () => () => {};

export function RatingsPanel({ items, visible, priority, defaultSelected, providers, fieldProviders, labels }: RatingsPanelProps): ReactElement {
  const raw = useSyncExternalStore(subscribe, getStoredRaw, () => null);
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const selected: readonly string[] = parseSelection(raw, fieldProviders.map((p) => p.id)) ?? defaultSelected;

  const { shown, primary } = selectRatings(items, { visible, selected, priority });
  const shownSet = new Set<RatingItem>(shown);
  const showSettings = providers.length >= 2;
  // 沒有可顯示的分數 → 所選來源的空白欄位（所選都不在允許清單時退回預設來源；不退回沒選的來源）
  const chosen = fieldProviders.filter((p) => selected.includes(p.id));
  const emptyShown = shown.length > 0 ? [] : chosen.length > 0 ? chosen : fieldProviders.filter((p) => defaultSelected.includes(p.id));

  const toggle = (id: string, checked: boolean) => {
    const next = checked ? [...new Set([...selected, id])] : selected.filter((x) => x !== id);
    writeStoredSelection(next);
  };

  return (
    <>
      <ul className="flex flex-col gap-2" data-rating-list>
        {items.map((item) => {
          const isShown = shownSet.has(item);
          return (
            <li
              key={`${item.scoreProvider}:${item.scoreType}:${item.platformId ?? "all"}`}
              data-score-provider={item.scoreProvider}
              data-score-type={item.scoreType}
              data-primary={item === primary ? "true" : undefined}
              hidden={!isShown}
            >
              <span className={item === primary ? "text-2xl font-bold" : "text-base"}>{item.text}</span>
            </li>
          );
        })}
        {emptyShown.map((p) => (
          <li key={`empty:${p.id}`} data-rating-empty={p.id} className="text-base">
            <span>{p.label}</span> <span aria-hidden="true">—</span>
            <span className="sr-only">{labels.noRatings}</span>
          </li>
        ))}
      </ul>
      {showSettings ? (
        // 無 JavaScript 時按了也不會有作用 → 水合前先 hidden
        <fieldset hidden={!mounted} className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1" data-rating-settings>
          <legend className="font-semibold">{labels.legend}</legend>
          {providers.map((p) => (
            <label key={p.id} className="inline-flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={(e) => toggle(p.id, e.currentTarget.checked)}
                data-score-provider-toggle={p.id}
              />
              {p.label}
            </label>
          ))}
          <span className="basis-full text-sm text-[var(--muted)]">{labels.hint}</span>
        </fieldset>
      ) : null}
    </>
  );
}

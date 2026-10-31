"use client";
/**
 * 搜尋框＋候選名單（header、首頁、遊戲列表頁共用的唯一元件）。WAI-ARIA combobox（list autocomplete）：
 * input `role="combobox"`、`aria-expanded`／`aria-controls`／`aria-activedescendant`，清單 `role="listbox"`／`option`。
 * - 打字 ≥ 1 字元、debounce 150ms 後呼叫 GET /api/v1/games/suggest；請求用 AbortController，舊回應不會蓋掉新結果。
 * - ↑↓ 移動選取（立即切換，不做動畫）、Enter 進入選中項（沒選中就照常送出所在的表單）、Esc 先關清單再清空、點外面關閉。
 * - 中文輸入法組字中（compositionstart～compositionend）不查詢、Enter 不送出。
 * - 結果數用 aria-live="polite" 宣告；沒有 JS 時它就是一般的 <input name="q">，表單照常送出。
 * 元件只負責輸入框與清單，表單由呼叫端提供（input 需要在 <form> 裡）。清單第一次出現時淡入，之後隨打字更新不重播。
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactElement } from "react";
import type { Locale } from "@sok/i18n";
import { fillTemplate, useHydrated } from "../calendar/use-day-cards";
import { gameHref } from "../links";
import { gameNameLang } from "../name-lang";
import { COMBO_CLOSED, comboKeyDown, type ComboState } from "./combobox-state";
import type { SearchBoxLabels } from "./labels";

/** GET /api/v1/games/suggest 回應中的一筆（與 catalog/api/game-suggest.ts 的 GameSuggestionDto 一致）。 */
export interface SuggestItem {
  slug: string;
  name: string;
  originalName: string;
  coverUrl: string | null;
  year: number | null;
  platforms: string[];
}

export const SUGGEST_ENDPOINT = "/api/v1/games/suggest";
export const SUGGEST_DEBOUNCE_MS = 150;

export interface SearchComboboxProps {
  locale: Locale;
  /** input 的 id（外部 <label htmlFor> 用；也是清單各項 id 的前綴）。 */
  id: string;
  name?: string;
  defaultValue?: string;
  maxLength?: number;
  placeholder?: string;
  /** 沒有外部 <label> 時的可及名稱。 */
  ariaLabel?: string;
  labels: SearchBoxLabels;
  className?: string;
  inputClassName?: string;
}

type Status = "idle" | "loading" | "done" | "error";

export function SearchCombobox({ locale, id, name = "q", defaultValue = "", maxLength, placeholder, ariaLabel, labels, className, inputClassName }: SearchComboboxProps): ReactElement {
  const router = useRouter();
  const hydrated = useHydrated();
  const uid = useId();
  const listId = `${id}-list-${uid.replace(/:/g, "")}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const composing = useRef(false);
  const cache = useRef(new Map<string, SuggestItem[]>());

  const [value, setValue] = useState(defaultValue);
  const [items, setItems] = useState<SuggestItem[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [state, setState] = useState<ComboState>(COMBO_CLOSED);
  const [announce, setAnnounce] = useState("");

  const optionCount = items.length > 0 ? items.length + 1 : 0;
  const trimmed = value.trim();
  const showList = state.open && trimmed !== "" && items.length > 0;
  const showEmpty = state.open && trimmed !== "" && status === "done" && items.length === 0;
  const showError = state.open && trimmed !== "" && status === "error";
  const optionId = (i: number) => (i === items.length ? `${id}-opt-all` : `${id}-opt-${i}`);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    abort.current?.abort();
    abort.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const run = useCallback(
    (q: string) => {
      const key = `${locale}\n${q}`;
      const hit = cache.current.get(key);
      if (hit) {
        setItems(hit);
        setStatus("done");
        setAnnounce(hit.length > 0 ? fillTemplate(labels.count, { n: hit.length }) : labels.empty);
        return;
      }
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      setStatus("loading");
      fetch(`${SUGGEST_ENDPOINT}?q=${encodeURIComponent(q)}&locale=${encodeURIComponent(locale)}`, { signal: ctl.signal, headers: { Accept: "application/json" } })
        .then((res) => {
          if (!res.ok) throw new Error(`suggest ${res.status}`);
          return res.json() as Promise<{ items: SuggestItem[] }>;
        })
        .then((body) => {
          if (ctl.signal.aborted) return;
          cache.current.set(key, body.items);
          setItems(body.items);
          setStatus("done");
          setAnnounce(body.items.length > 0 ? fillTemplate(labels.count, { n: body.items.length }) : labels.empty);
          setState((s) => (s.active >= body.items.length + 1 ? { ...s, active: -1 } : s));
        })
        .catch((e: unknown) => {
          if (ctl.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
          setItems([]);
          setStatus("error");
          setAnnounce(labels.error);
        });
    },
    [labels.count, labels.empty, labels.error, locale],
  );

  const schedule = useCallback(
    (raw: string) => {
      cancel();
      const q = raw.trim();
      if (q === "") {
        setItems([]);
        setStatus("idle");
        setAnnounce("");
        setState(COMBO_CLOSED);
        return;
      }
      timer.current = setTimeout(() => run(q), SUGGEST_DEBOUNCE_MS);
    },
    [cancel, run],
  );

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setValue(next);
    if (next.trim() !== "") setState({ open: true, active: -1 });
    if (!composing.current && !(e.nativeEvent as InputEvent).isComposing) schedule(next);
  };

  const choose = (i: number) => {
    setState(COMBO_CLOSED);
    if (i === items.length) {
      const form = inputRef.current?.form;
      if (form) form.requestSubmit();
      return;
    }
    const item = items[i];
    if (item) router.push(gameHref(locale, item.slug));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) {
      // 輸入法組字／剛確認選字：Enter 只用來確認，不送出表單
      if (e.key === "Enter") e.preventDefault();
      return;
    }
    const r = comboKeyDown(state, e.key, { count: optionCount, value });
    if (r.state !== state) setState(r.state);
    if (r.handled) e.preventDefault();
    if (r.clear) {
      setValue("");
      schedule("");
    }
    if (r.select) choose(r.state.active);
    // 沒選中任何候選就按 Enter＝整個搜尋送出：清單要收起來，不能蓋住送出後的結果與條件 chip
    else if (e.key === "Enter") {
      cancel();
      setState(COMBO_CLOSED);
    }
  };

  // 點外面關閉
  useEffect(() => {
    if (!state.open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setState(COMBO_CLOSED);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [state.open]);

  const activeId = showList && state.active >= 0 ? optionId(state.active) : undefined;

  return (
    <div ref={rootRef} className={["sb-root", className].filter(Boolean).join(" ")} data-search-combobox="" data-hydrated={hydrated ? "true" : undefined}>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={showList ? listId : undefined}
        aria-activedescendant={activeId}
        aria-label={ariaLabel}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="search"
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        className={inputClassName}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(e) => {
          composing.current = false;
          schedule(e.currentTarget.value);
        }}
        onFocus={() => {
          if (trimmed !== "" && (items.length > 0 || status === "done")) setState((s) => ({ ...s, open: true }));
        }}
      />
      <div aria-live="polite" className="sr-only" data-search-status="">
        {announce}
      </div>
      {showList || showEmpty || showError ? (
        <div className="sb-popup" data-search-popup="" aria-busy={status === "loading"} onMouseDown={(e) => e.preventDefault()}>
          {showList ? (
            <ul id={listId} role="listbox" aria-label={labels.listLabel} className="sb-list">
              {items.map((item, i) => {
                const meta = [item.year ? String(item.year) : null, item.platforms.join(" · ") || null].filter(Boolean).join(" · ");
                return (
                  <li
                    key={item.slug}
                    id={optionId(i)}
                    role="option"
                    aria-selected={state.active === i}
                    data-active={state.active === i ? "true" : undefined}
                    className="sb-option"
                    onMouseMove={() => state.active !== i && setState((s) => ({ ...s, active: i }))}
                    onClick={() => choose(i)}
                  >
                    {item.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- 小縮圖（IGDB CDN 已縮放），不經最佳化器
                      <img src={item.coverUrl} alt="" width={30} height={42} loading="lazy" decoding="async" className="sb-cover" />
                    ) : (
                      <span aria-hidden="true" className="sb-cover sb-cover-empty" />
                    )}
                    <span className="sb-text">
                      <span className="sb-title" lang={gameNameLang(item.name, item.name === item.originalName, locale)}>
                        {item.name}
                      </span>
                      {meta ? <span className="sb-meta">{meta}</span> : null}
                    </span>
                  </li>
                );
              })}
              <li
                id={optionId(items.length)}
                role="option"
                aria-selected={state.active === items.length}
                data-active={state.active === items.length ? "true" : undefined}
                className="sb-option sb-all"
                onMouseMove={() => state.active !== items.length && setState((s) => ({ ...s, active: items.length }))}
                onClick={() => choose(items.length)}
              >
                {labels.viewAll}
              </li>
            </ul>
          ) : null}
          {showEmpty ? (
            <p className="sb-note" aria-hidden="true" data-search-empty="">
              {labels.empty}
            </p>
          ) : null}
          {showError ? (
            <p className="sb-note" aria-hidden="true">
              {labels.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

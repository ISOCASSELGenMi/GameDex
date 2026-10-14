/**
 * IGDB 活動名稱 → 我方活動類型（EventKind）。IGDB 的 events 沒有類型欄位（2026-10 實測 960 筆），
 * 使用者 2026-10-13 定案：在 Provider 層依名稱推斷。只用於 source='igdb' 的活動；人工活動不經這裡。
 *
 * 規則依序比對，第一個符合的決定類型（對照表 EVENT_KIND_RULES，單元測試逐條驗證）：
 * 1. 發表會（showcase）：Direct／Showcase／Presentation／Live／Spotlight／Reveal／Press Conference／Briefing／
 *    State of …／Connect／Forward／Show（非 Tokyo／Taipei Game Show、非 Award Show）……
 *    也包含「X at Tokyo Game Show」「X @ gamescom」「Pre-E3」這類**廠商在展會期間的節目**，
 *    以及「…: The Game Awards Edition」這類**搭配大型活動的周邊節目**（Edition）。
 *    排在最前面是因為很多發表會名稱裡帶著展會或頒獎典禮的名字（Nintendo E3 2005 Press Conference、
 *    Women-Led Games Showcase: The Game Awards Edition）。
 * 2. 頒獎（awards）：Award／Awards（含 Award Show）、Premiação、VGX。
 * 3. 展會（expo）：Expo、E3、gamescom、Tokyo Game Show、Taipei Game Show、PAX、Summer Game Fest、BitSummit、
 *    BlizzCon、CES、Space World、Shoshinkai、Convention、SAGE（Sonic Amateur Games Expo）、NCFC（Nintendo Community
 *    Fangame Convention）、PlayStation Experience。
 * 4. 弱發表會關鍵字：Event、Update、Highlights、Announcement（「Apple Event」「Playdate Update」）。
 * 5. 其餘 other。
 *
 * 比對不分大小寫。規則是啟發式的，已知誤判見 3b K 報告；管理員改過的類型不會被同步覆蓋（見 repository/events.ts）。
 */
import type { EventKind } from "../../domain/entities";

export interface EventKindRule {
  kind: EventKind;
  /** 規則代號（測試與報告用）。 */
  id: string;
  pattern: RegExp;
}

/** 依序比對；第一個符合的規則決定類型。 */
export const EVENT_KIND_RULES: readonly EventKindRule[] = [
  // 1. 發表會（強）
  {
    kind: "showcase",
    id: "showcase-keyword",
    pattern:
      /\b(direct|showcase|presentation|presents|spotlight|reveal|keynote|briefing|press conference|press event|conference|connect|forward|transmission|premiere|preview|program|treehouse|opening|special address|edition)\b|developer_direct/i,
  },
  { kind: "showcase", id: "showcase-live", pattern: /\blive\b/i },
  { kind: "showcase", id: "showcase-state-of", pattern: /\bstate of\b/i },
  // 「Show」但不是 Tokyo／Taipei Game Show、不是 Award Show
  { kind: "showcase", id: "showcase-show", pattern: /(?<!\b(?:tokyo|taipei) games? |\bawards? )\bshow\b/i },
  // 廠商在展會期間的節目：「X at Tokyo Game Show」「X @ gamescom」「Xbox Tokyo Game Show」「Pre-E3／Non-E3」
  {
    kind: "showcase",
    id: "showcase-at-expo",
    pattern: /(?:\bat|@|\bxbox)\s*(?:tokyo game show|gamescom|e3|pax)\b|\b(?:pre|non)-e3\b/i,
  },
  // 2. 頒獎
  { kind: "awards", id: "awards", pattern: /\bawards?\b|\bpremia[cç][aã]o\b|^vgx\b/i },
  // 3. 展會
  {
    kind: "expo",
    id: "expo",
    pattern:
      /\b(expo|e3|gamescom|tokyo games? show|taipei games? show|tgs|pax|summer game fest|bitsummit|blizzcon|ces|space ?world|shoshinkai|convention|sage|ncfc|playstation experience)\b/i,
  },
  // 4. 弱發表會關鍵字
  { kind: "showcase", id: "showcase-weak", pattern: /\b(event|update|highlights|announcements?)\b/i },
];

/** 依規則推斷；回傳類型與命中的規則代號（other 時為 null）。 */
export function classifyIgdbEventName(name: string): { kind: EventKind; ruleId: string | null } {
  const n = name.normalize("NFC");
  for (const rule of EVENT_KIND_RULES) {
    if (rule.pattern.test(n)) return { kind: rule.kind, ruleId: rule.id };
  }
  return { kind: "other", ruleId: null };
}

/** IGDB 活動名稱 → EventKind（toEventRecord 與重新分類共用）。 */
export function inferIgdbEventKind(name: string): EventKind {
  return classifyIgdbEventName(name).kind;
}

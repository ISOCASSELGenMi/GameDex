/**
 * 外部連結對照（04 §外部連結）：websites.type 與 external_games.external_game_source → (categoryLabel, linkType)。
 * 字典於 2026-10-12 以 website_types／external_game_sources 端點核對。
 */
import type { GameLinkRecord, GameLinkType } from "../../domain/entities";

type LinkDef = readonly [categoryLabel: string, linkType: GameLinkType];

export const WEBSITE_TYPE_MAP: Readonly<Record<number, LinkDef>> = {
  1: ["official_website", "official"],
  2: ["community_wiki", "media"],
  3: ["wikipedia", "media"],
  6: ["twitch", "media"],
  9: ["youtube", "media"],
  4: ["facebook", "social"],
  5: ["twitter", "social"],
  8: ["instagram", "social"],
  14: ["subreddit", "social"],
  18: ["discord", "social"],
  19: ["bluesky", "social"],
  13: ["steam", "store"],
  16: ["epic", "store"],
  17: ["gog", "store"],
  22: ["xbox_store", "store"],
  23: ["playstation_store", "store"],
  24: ["nintendo_eshop", "store"],
  12: ["google_play", "store"],
  10: ["app_store", "store"],
  11: ["app_store", "store"],
  15: ["itch", "store"],
  25: ["meta", "store"],
  26: ["gamejolt", "store"],
};

export const EXTERNAL_GAME_SOURCE_MAP: Readonly<Record<number, LinkDef>> = {
  1: ["steam", "store"],
  5: ["gog", "store"],
  26: ["epic", "store"],
  36: ["playstation_store", "store"],
  31: ["xbox_store", "store"],
  11: ["microsoft_store", "store"],
  3: ["giantbomb", "media"],
  10: ["youtube", "media"],
  14: ["twitch", "media"],
};

/** IGDB 自己，略過。 */
const EXTERNAL_SOURCE_IGDB = 121;
export const EXTERNAL_SOURCE_STEAM = 1;

/**
 * 字典漂移偵測（04 §外部連結）用的「已知 id」：對照表的鍵＋刻意不收錄（歸 other）的 id。
 * 2026-10-13 對 website_types（23 個，全部收錄）與 external_game_sources（22 個）核對。
 */
export const KNOWN_WEBSITE_TYPE_IDS: readonly number[] = Object.keys(WEBSITE_TYPE_MAP).map(Number);
export const KNOWN_EXTERNAL_GAME_SOURCE_IDS: readonly number[] = [
  ...Object.keys(EXTERNAL_GAME_SOURCE_MAP).map(Number),
  // Apple、Android、Amazon、Amazon Luna、Amazon ADG、Oculus、Utomik、Itchio、Kartridge、Focus Entertainment、
  // Xbox Game Pass Ultimate Cloud、GameJolt、IGDB
  13, 15, 20, 22, 23, 28, 29, 30, 32, 37, 54, 55, EXTERNAL_SOURCE_IGDB,
];

/** 字典裡出現、但不在已知清單的 id（升冪）。 */
export function findNewDictionaryIds(known: readonly number[], current: readonly number[]): number[] {
  const k = new Set(known);
  return [...new Set(current.filter((id) => !k.has(id)))].sort((a, b) => a - b);
}

export interface RawWebsite {
  url?: string;
  type?: number;
}
export interface RawExternalGame {
  url?: string;
  external_game_source?: number;
  uid?: string;
}

export interface BuildLinksResult {
  links: GameLinkRecord[];
  /** 未收錄的字典 id（呼叫端彙整後記警告）。 */
  unmapped: Array<{ origin: "website" | "external_game"; id: number }>;
}

/**
 * websites 先、external_games 後，以 categoryLabel 去重（websites 的網址優先）。
 * 未收錄的 id → categoryLabel='other'、linkType 依來源（websites → official、external_games → store）。
 * 沒有網址的略過。
 */
export function buildGameLinks(websites: readonly RawWebsite[], externalGames: readonly RawExternalGame[]): BuildLinksResult {
  const byLabel = new Map<string, GameLinkRecord>();
  const unmapped: BuildLinksResult["unmapped"] = [];
  const add = (link: GameLinkRecord) => {
    if (!byLabel.has(link.categoryLabel)) byLabel.set(link.categoryLabel, link);
  };

  for (const w of websites) {
    const url = w.url?.trim();
    if (!url || w.type == null) continue;
    const def = WEBSITE_TYPE_MAP[w.type];
    if (!def) unmapped.push({ origin: "website", id: w.type });
    const [categoryLabel, linkType] = def ?? ["other", "official"];
    add({ categoryLabel, linkType, url, igdbCategory: w.type, igdbOrigin: "website" });
  }
  for (const e of externalGames) {
    const url = e.url?.trim();
    const src = e.external_game_source;
    if (!url || src == null || src === EXTERNAL_SOURCE_IGDB) continue;
    const def = EXTERNAL_GAME_SOURCE_MAP[src];
    if (!def) unmapped.push({ origin: "external_game", id: src });
    const [categoryLabel, linkType] = def ?? ["other", "store"];
    add({ categoryLabel, linkType, url, igdbCategory: src, igdbOrigin: "external_game" });
  }
  return { links: [...byLabel.values()], unmapped };
}

/** Steam 的 external_games.uid 就是 AppID（🧪）。 */
export function steamAppIdOf(externalGames: readonly RawExternalGame[]): string | null {
  const uid = externalGames.find((e) => e.external_game_source === EXTERNAL_SOURCE_STEAM && e.uid?.trim())?.uid;
  return uid?.trim() || null;
}

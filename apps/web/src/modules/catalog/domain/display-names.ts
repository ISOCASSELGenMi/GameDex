/**
 * 各語系的遊戲顯示名稱（06 §遊戲名稱解析鏈；同步時預先算好寫入 games.displayNames）。
 * 1. game_localizations 對應 locale 的名稱（人工 source=manual 優先於 igdb）。IGDB 只有 ja、ko（ko 只存不顯示）。
 * 2. zh-Hant：IGDB 沒有中文地區，只在 alternativeNames 的 comment 明確標「Traditional」或「Taiwan」時採用；
 *    只標「Chinese title」（繁簡不明）、標 simplified、romanization、pinyin、translated 者不採用（只當搜尋別名）。不做簡轉繁。
 * 3. 以上都沒有 → 不寫該語系的 key，讀取端退回 games.name。
 */

export interface LocalizationName {
  localeCode: string;
  name: string;
  source: string;
}

export interface AlternativeName {
  name: string;
  comment: string | null;
}

const HAN = /\p{Script=Han}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
/**
 * IGDB 的 comment 繁簡標示不可靠（實測有標 traditional 卻是簡體的）。名稱含下列「簡體專用字」（繁體寫法不同）就不採用。
 * 清單只涵蓋常見字，是降低誤用的護欄，不是簡繁判斷；不做簡轉繁。
 */
const SIMPLIFIED_ONLY = new Set([..."国对战级龙门时样岛们这个来说无为与会发动爱乐点网业东书车见长边过还进远运选达连类纪给统经织线终组结绝约红练项须顺预题风飞马鸟鱼麦黄齐龟济齿阳阴际场报势区医协单卫历压厅县双变启则刚剑显严乡争亚产亲仅从仓优传伤伦侠侣众农决冲况净凤击创劳却厂参团园围图圣块坏垒备头夺奖孙宁宝实审宫库应开异弃张强归当录彻总恋悬惊惨态户执扩护抢担拥拟择挂挡损换据摇数断旧晓暂术杀杂权条构标欢毕气汇汉湾灭灯灵热爷犹独猎现琐电畅疗监盖盘矿础确离穷竞节获继缘罗联职胜腾艺药虽补装规视览触计订认讨让训议记讲许论设访证评识诉词译试诗话该详语误请读课谁调谈谜谢谱贝负财责败货质贩购贯贵费贸资赛赢赶趋践轨转软轮较载辅辈输迁办适邮邻释针钓钟钢钥钱铁铃银链锁锋错键镇闪问闭间闲闹阵阶阻险随隐难雾静页顶顾领频颜额饭饮饰馆驱驾验骑骗体"]);
const TRADITIONAL_COMMENT = /\b(traditional|taiwan(ese)?)\b/i;
const EXCLUDED_COMMENT = /simplified|romani[sz]ation|pinyin|translat|transliterat/i;

/** 從別名挑 zh-Hant 顯示名稱；沒有可信的回傳 null。 */
export function pickTraditionalChineseAlternative(alternatives: readonly AlternativeName[]): string | null {
  for (const a of alternatives) {
    const comment = a.comment ?? "";
    const name = a.name.trim();
    if (!name || !TRADITIONAL_COMMENT.test(comment) || EXCLUDED_COMMENT.test(comment)) continue;
    if (!HAN.test(name) || KANA.test(name)) continue;
    if ([...name].some((ch) => SIMPLIFIED_ONLY.has(ch))) continue;
    return name;
  }
  return null;
}

export function resolveDisplayNames(
  localizations: readonly LocalizationName[],
  alternatives: readonly AlternativeName[],
): Record<string, string> {
  const out: Record<string, string> = {};
  // manual 排在後面，覆蓋 igdb
  for (const l of [...localizations].sort((a, b) => Number(a.source === "manual") - Number(b.source === "manual"))) {
    out[l.localeCode] = l.name;
  }
  if (!out["zh-Hant"]) {
    const alt = pickTraditionalChineseAlternative(alternatives);
    if (alt) out["zh-Hant"] = alt;
  }
  return out;
}

// Phase 4：標題比對（05 §標題比對）——normalizeTitle、levenshteinSimilarity、findBestMatch。純函式，無 DB。
import { describe, expect, it } from "vitest";
import type { Candidate } from "@/modules/catalog";
import { findBestMatch, levenshteinSimilarity, normalizeTitle } from "@/modules/catalog/use-cases/matching";

const c = (externalId: string, name: string, releaseYear: number | null = null, platforms?: string[]): Candidate => ({
  externalId,
  name,
  releaseYear,
  platforms,
});

describe("normalizeTitle", () => {
  it("小寫、去 ™®©、& → and、冒號與破折號變空白、壓縮空白", () => {
    expect(normalizeTitle("The Witcher® 3: Wild Hunt™")).toBe("the witcher 3 wild hunt");
    expect(normalizeTitle("Ratchet & Clank")).toBe("ratchet and clank");
    expect(normalizeTitle("Half-Life – Alyx — Test")).toBe("half life alyx test");
    expect(normalizeTitle("  Hades   II  ")).toBe("hades ii");
  });

  it("版本字（Deluxe／GOTY／Edition…）被移除", () => {
    expect(normalizeTitle("Skyrim Definitive Edition")).toBe("skyrim");
    expect(normalizeTitle("Borderlands: Game of the Year Edition")).toBe("borderlands");
    expect(normalizeTitle("Fallout 4 GOTY")).toBe("fallout 4");
    expect(normalizeTitle("Cyberpunk 2077 Ultimate Edition")).toBe("cyberpunk 2077");
    expect(normalizeTitle("Hitman Deluxe")).toBe("hitman");
    expect(normalizeTitle("Mass Effect Legendary Edition")).toBe("mass effect legendary");
  });

  it("拉丁擴充區去重音；NFKC 處理全形與羅馬數字", () => {
    expect(normalizeTitle("Pokémon Café")).toBe("pokemon cafe");
    expect(normalizeTitle("Ōkami")).toBe("okami");
    expect(normalizeTitle("ＦＩＮＡＬ ＦＡＮＴＡＳＹ Ⅶ")).toBe("final fantasy vii");
  });

  it("CJK 字元保留（不用 \\w）；日文濁音不被拆開", () => {
    expect(normalizeTitle("艾爾登法環")).toBe("艾爾登法環");
    expect(normalizeTitle("ゼルダの伝説 ブレス オブ ザ ワイルド")).toBe("ゼルダの伝説 ブレス オブ ザ ワイルド");
    // 濁音「ガ」「ビ」仍是單一字元的組合，沒被 NFKD 拆成「カ」＋濁點
    expect(normalizeTitle("ガビ")).toBe("ガビ");
    expect(Array.from(normalizeTitle("ガビ"))).toHaveLength(2);
    expect(normalizeTitle("엘든 링")).toBe("엘든 링");
  });

  it("全是符號 → 空字串", () => {
    expect(normalizeTitle("™®©")).toBe("");
    expect(normalizeTitle("!!! ??? ---")).toBe("");
    expect(normalizeTitle("   ")).toBe("");
    expect(normalizeTitle("Deluxe Edition")).toBe("");
  });
});

describe("levenshteinSimilarity", () => {
  it("相同 1、完全不同 0、單字元差", () => {
    expect(levenshteinSimilarity("abc", "abc")).toBe(1);
    expect(levenshteinSimilarity("abc", "xyz")).toBe(0);
    expect(levenshteinSimilarity("kitten", "sitting")).toBeCloseTo(1 - 3 / 7, 10);
    expect(levenshteinSimilarity("abc", "abd")).toBeCloseTo(2 / 3, 10);
  });
  it("空字串：兩個都空不算相同（0）；一邊空 0", () => {
    expect(levenshteinSimilarity("", "")).toBe(0);
    expect(levenshteinSimilarity("", "abc")).toBe(0);
    expect(levenshteinSimilarity("abc", "")).toBe(0);
  });
  it("以字元計，中日韓與代理對不被拆開", () => {
    expect(levenshteinSimilarity("艾爾登法環", "艾爾登法環")).toBe(1);
    expect(levenshteinSimilarity("艾爾登法環", "艾爾登法鐶")).toBeCloseTo(0.8, 10);
    expect(levenshteinSimilarity("😀a", "😀b")).toBeCloseTo(0.5, 10);
  });
});

describe("findBestMatch", () => {
  it("完全相同（含年份）→ 自動採用", () => {
    const m = findBestMatch("Elden Ring", [], 2022, [c("elden-ring", "Elden Ring", 2022)]);
    expect(m).toMatchObject({ externalId: "elden-ring", confidencePct: 100, needsReview: false });
  });

  it("版本字、重音、& 不影響配對", () => {
    expect(findBestMatch("Ratchet & Clank", [], null, [c("a", "Ratchet and Clank")])?.confidencePct).toBe(100);
    expect(findBestMatch("Pokémon Sword", [], null, [c("a", "Pokemon Sword")])?.confidencePct).toBe(100);
    expect(findBestMatch("Skyrim Special Edition Deluxe", [], null, [c("a", "Skyrim Special")])?.confidencePct).toBe(100);
    expect(findBestMatch("Borderlands GOTY Edition", [], null, [c("a", "Borderlands")])?.confidencePct).toBe(100);
  });

  it("alternativeNames 取最高：英文名對不上、中文別名對上", () => {
    const m = findBestMatch("Elden Ring", ["艾爾登法環"], 2022, [c("x", "艾爾登法環", 2022)]);
    expect(m).toMatchObject({ externalId: "x", confidencePct: 100, needsReview: false });
  });

  it("CJK：日文含濁音、韓文、中文都能比對", () => {
    expect(findBestMatch("ガビ", [], null, [c("a", "ガビ")])?.confidencePct).toBe(100);
    expect(findBestMatch("エルデンリング", [], null, [c("a", "エルデンリング")])?.confidencePct).toBe(100);
    expect(findBestMatch("엘든 링", [], null, [c("a", "엘든 링")])?.confidencePct).toBe(100);
    // 濁音差一字：デ→テ 只算 1 個字元的差（NFKD 會拆成 2 個）→ 6/7 ≈ 86
    expect(findBestMatch("エルデンリング", [], null, [c("a", "エルテンリング")])?.confidencePct).toBe(86);
    // 日文與中文完全不同 → 無候選
    expect(findBestMatch("エルデンリング", [], null, [c("a", "艾爾登法環")])).toBeNull();
  });

  it("全符號標題正規化為空 → 不得互配（我方空、候選空、兩邊皆空）", () => {
    expect(findBestMatch("™®©", [], null, [c("a", "!!!")])).toBeNull();
    expect(findBestMatch("!!!", [], null, [c("a", "!!!")])).toBeNull();
    expect(findBestMatch("Real Game", [], null, [c("a", "™®©")])).toBeNull();
    expect(findBestMatch("™", ["Deluxe Edition"], null, [c("a", "???")])).toBeNull();
    // 我方主名稱為空但別名正常 → 仍可用別名配
    expect(findBestMatch("™", ["Hades"], null, [c("a", "Hades")])?.confidencePct).toBe(100);
  });

  it("續作／原作（token 子集）上限 84 → 一定要覆核", () => {
    const sequel = findBestMatch("Final Fantasy VII", [], 2020, [c("ff7r", "Final Fantasy VII Remake", 2020)]);
    expect(sequel).not.toBeNull();
    expect(sequel!.confidencePct).toBeLessThanOrEqual(84);
    expect(sequel!.needsReview).toBe(true);
    // 反方向（我方是續作）
    const prequel = findBestMatch("Resident Evil 4 Remake", [], 2023, [c("re4", "Resident Evil 4", 2023)]);
    expect(prequel!.confidencePct).toBeLessThanOrEqual(84);
    expect(prequel!.needsReview).toBe(true);
    // 完全相同的 token 集合不受上限影響
    expect(findBestMatch("Portal 2", [], null, [c("p2", "Portal 2")])?.confidencePct).toBe(100);
  });

  it("續作子集案例：原作與續作並列時選原作，且因差距小/子集仍可能進覆核但不會配成續作", () => {
    const m = findBestMatch("Portal", [], 2007, [c("p2", "Portal 2", 2011), c("p1", "Portal", 2007)]);
    expect(m?.externalId).toBe("p1");
    expect(m?.confidencePct).toBe(100);
    expect(m?.needsReview).toBe(false); // 100 對 ≤84
  });

  it("年份：相同 +5、差 1~2 年不加減、差 >2 年 −20、任一方未知不加減", () => {
    // 「Hollow Knight」vs「Hollow Knigh」：8/9... 以編輯距離 1 的名稱製造 <100 的基準
    const base = findBestMatch("Starfield Gate", [], null, [c("a", "Starfield Gat")])!.confidencePct; // 14 字元、距離 1 → 93
    expect(base).toBe(93);
    expect(findBestMatch("Starfield Gate", [], 2023, [c("a", "Starfield Gat", 2023)])!.confidencePct).toBe(98);
    expect(findBestMatch("Starfield Gate", [], 2023, [c("a", "Starfield Gat", 2021)])!.confidencePct).toBe(93);
    expect(findBestMatch("Starfield Gate", [], 2023, [c("a", "Starfield Gat", 2025)])!.confidencePct).toBe(93);
    expect(findBestMatch("Starfield Gate", [], 2023, [c("a", "Starfield Gat", 2019)])!.confidencePct).toBe(73);
    expect(findBestMatch("Starfield Gate", [], null, [c("a", "Starfield Gat", 2019)])!.confidencePct).toBe(93);
    expect(findBestMatch("Starfield Gate", [], 2023, [c("a", "Starfield Gat", null)])!.confidencePct).toBe(93);
  });

  it("年份差距 >2 年可把自動配對降成覆核，甚至無候選", () => {
    expect(findBestMatch("Starfield Gate", [], 2023, [c("a", "Starfield Gat", 2019)])).toMatchObject({ confidencePct: 73, needsReview: true });
    expect(findBestMatch("Gate", [], 2023, [c("a", "Gate", 2010)])).toMatchObject({ confidencePct: 80, needsReview: true });
    // 同名但年份差很多，加上名稱略有差異 → 低於 60 無候選
    expect(findBestMatch("Starfield Gate", [], 2023, [c("a", "Starfield Gxxx", 2005)])).toBeNull();
  });

  it("門檻：<60 無候選、60~84 覆核、≥85 自動", () => {
    expect(findBestMatch("abcdefghij", [], null, [c("a", "abcdexxxxx")])).toBeNull(); // 50
    expect(findBestMatch("abcdefghij", [], null, [c("a", "abcdefxxxx")])).toMatchObject({ confidencePct: 60, needsReview: true });
    expect(findBestMatch("abcdefghij", [], null, [c("a", "abcdefghxx")])).toMatchObject({ confidencePct: 80, needsReview: true });
    expect(findBestMatch("abcdefghij", [], null, [c("a", "abcdefghix")])).toMatchObject({ confidencePct: 90, needsReview: false });
    expect(findBestMatch("abcdefghijklmnopqrst", [], null, [c("a", "abcdefghijklmnopqrsx")])).toMatchObject({ confidencePct: 95, needsReview: false });
  });

  it("≥85 但最佳與次佳差距 <5 → 仍須覆核；差距 ≥5 → 自動", () => {
    const close = findBestMatch("abcdefghij", [], null, [c("a", "abcdefghix"), c("b", "abcdefghiy")]); // 90 vs 90
    expect(close).toMatchObject({ externalId: "a", confidencePct: 90, needsReview: true });
    const far = findBestMatch("abcdefghijklmnopqrst", [], null, [c("a", "abcdefghijklmnopqrsx"), c("b", "abcdefghijklmnopqxxx")]); // 95 vs 85
    expect(far).toMatchObject({ externalId: "a", confidencePct: 95, needsReview: false });
  });

  it("同一 externalId 重複出現不算次佳", () => {
    const m = findBestMatch("Elden Ring", [], 2022, [c("same", "Elden Ring", 2022), c("same", "Elden Ring", 2022)]);
    expect(m).toMatchObject({ confidencePct: 100, needsReview: false });
  });

  it("平台重疊 +3（選用）", () => {
    const without = findBestMatch("Starfield Gate", [], null, [c("a", "Starfield Gat", null, ["ps5"])])!;
    const withPlat = findBestMatch("Starfield Gate", [], null, [c("a", "Starfield Gat", null, ["ps5"])], { platforms: ["ps5", "pc"] })!;
    expect(without.confidencePct).toBe(93);
    expect(withPlat.confidencePct).toBe(96);
    const noOverlap = findBestMatch("Starfield Gate", [], null, [c("a", "Starfield Gat", null, ["xbox"])], { platforms: ["ps5"] })!;
    expect(noOverlap.confidencePct).toBe(93);
  });

  it("分數上限 100（年份加分不會超過）", () => {
    expect(findBestMatch("Hades", [], 2020, [c("a", "Hades", 2020)])?.confidencePct).toBe(100);
  });

  it("沒有候選、候選全空 → null", () => {
    expect(findBestMatch("Hades", [], 2020, [])).toBeNull();
    expect(findBestMatch("Hades", [], 2020, [c("a", "")])).toBeNull();
  });

  it("回傳候選的 name 與 externalUrl", () => {
    const m = findBestMatch("Hades", [], null, [{ externalId: "hades", name: "Hades", releaseYear: null, externalUrl: "https://x.example/hades" }]);
    expect(m).toEqual({ externalId: "hades", name: "Hades", externalUrl: "https://x.example/hades", confidencePct: 100, needsReview: false });
  });
});

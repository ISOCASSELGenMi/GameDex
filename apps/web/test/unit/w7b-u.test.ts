/** Phase 7 第 5～7 波細則（D83）的純函式與字典：上升中門檻、卡片掛載點、追蹤狀態批次上限、slot 註冊、新字典 key、用詞。 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MESSAGES, flattenMessages, type Locale } from "@sok/i18n";
import { accountsModule } from "@/modules/accounts/module";
import { FOLLOW_STATE_TARGETS_MAX, parseStateTargets } from "@/modules/accounts/domain/entities/follows";
import { orphanSanityAlertMessage } from "@/modules/accounts/use-cases/follows";
import { suspendedResponse } from "@/modules/accounts/use-cases/suspension";
import { accountStrings } from "@/modules/accounts/ui/strings";
import { FOLLOW_RISING_MIN_7D_DEFAULT, isRising, resolveFollowCountMinDisplay, resolveFollowRisingMin7d, RISING_TOP_FRACTION } from "@/modules/catalog/domain/follow-display";
import { CARD_ACTION_HOST_ATTR, CardActionHost } from "@/modules/catalog/ui/card-action-host";

const LOCALES: Locale[] = ["zh-Hant", "en", "ja"];

describe("「上升中」門檻（D83）", () => {
  it("預設門檻與 FOLLOW_COUNT_MIN_DISPLAY 的預設相同（10）；環境變數須為正整數", () => {
    expect(FOLLOW_RISING_MIN_7D_DEFAULT).toBe(10);
    expect(FOLLOW_RISING_MIN_7D_DEFAULT).toBe(resolveFollowCountMinDisplay(undefined));
    expect(resolveFollowRisingMin7d(undefined)).toBe(10);
    expect(resolveFollowRisingMin7d("")).toBe(10);
    expect(resolveFollowRisingMin7d("25")).toBe(25);
    for (const bad of ["0", "-3", "2.5", "abc"]) expect(resolveFollowRisingMin7d(bad)).toBe(10);
  });

  it("需要「7 日新增 ≥ 門檻」且「群內前 5%」兩者同時成立", () => {
    expect(isRising(10, 0, 10)).toBe(true);
    expect(isRising(9, 0, 10)).toBe(false); // 第一名但新增不到 10
    expect(isRising(500, RISING_TOP_FRACTION, 10)).toBe(false); // 邊界：剛好 5% 不算（< 5%）
    expect(isRising(500, 0.049, 10)).toBe(true);
    expect(isRising(500, 0.5, 10)).toBe(false); // 新增很多，但不在前 5%
    expect(isRising(500, null, 10)).toBe(false); // 沒有排名（不在群內或沒有訊號）
    expect(isRising(3, 0, 3)).toBe(true); // 可用環境變數調低
  });
});

describe("追蹤狀態批次上限（月曆一頁的卡片可能上百張）", () => {
  it("上限調到 300；超過 → too_many", () => {
    expect(FOLLOW_STATE_TARGETS_MAX).toBe(300);
    const ok = Array.from({ length: 300 }, (_, i) => `game:${i + 1}`).join(",");
    const parsed = parseStateTargets(ok);
    expect(parsed.ok && parsed.value.length).toBe(300);
    expect(parseStateTargets(`${ok},game:301`)).toEqual({ ok: false, fields: { targets: "too_many" } });
  });
});

describe("卡片動作掛載點（catalog 不認識 accounts）", () => {
  it("掛載點是空的 <span>，帶遊戲 id 與名稱，伺服器 HTML 與使用者無關", () => {
    const html = renderToStaticMarkup(createElement(CardActionHost, { gameId: 42, name: 'Tom & "Jerry"' }));
    expect(html).toBe(`<span class="card-action" ${CARD_ACTION_HOST_ATTR}="42" data-card-action-name="Tom &amp; &quot;Jerry&quot;"></span>`);
  });
});

describe("accounts manifest 的新 slot", () => {
  it("card.actions（卡片追蹤按鈕）與 filter.links（我的遊戲連結）", () => {
    expect(accountsModule.uiSlots?.["card.actions"]).toBeTypeOf("function");
    expect(accountsModule.uiSlots?.["filter.links"]).toBeTypeOf("function");
  });
});

describe("停權守門", () => {
  it("只有停權者回 403 account_suspended（no-store）", async () => {
    expect(suspendedResponse({ suspended: false })).toBeNull();
    const res = suspendedResponse({ suspended: true });
    expect(res?.status).toBe(403);
    expect(res?.headers.get("cache-control")).toBe("no-store");
    expect(await res?.json()).toEqual({ code: "account_suspended" });
  });
});

describe("孤兒清理告警訊息", () => {
  it("只有種類與數量", () => {
    const m = orphanSanityAlertMessage([
      { type: "game", targets: 25 },
      { type: "company", targets: 30 },
    ]);
    expect(m).toContain("game（25 個");
    expect(m).toContain("company（30 個");
    expect(m.startsWith("[SoK]")).toBe(true);
  });
});

describe("新字典 key 三語都有", () => {
  const keys = [
    "suspended.title",
    "suspended.body",
    "suspended.toPrivacy",
    "error.suspended",
    "follow.cardAria",
    "follow.cardOn",
    "follow.cardOff",
    "follow.count",
    "mygames.filterLink",
    "feedcal.settings.genres",
    "feedcal.settings.genresHint",
    "feedcal.settings.tooManyGenres",
  ];
  for (const locale of LOCALES) {
    it(`${locale}`, () => {
      const flat = flattenMessages(MESSAGES[locale].accounts);
      for (const k of keys) expect(flat.get(k), k).toBeTruthy();
      const s = accountStrings(locale, ["follow.card"]);
      expect(s["follow.cardAria"]).toContain("{name}");
    });
  }

  it("評論可見度「關注我的人」與遊戲追蹤用詞區分（D83）", () => {
    expect(flattenMessages(MESSAGES["zh-Hant"].accounts).get("play.visibility.followers")).toBe("關注我的人");
    expect(flattenMessages(MESSAGES["en"].accounts).get("play.visibility.followers")).toBe("My followers");
    expect(flattenMessages(MESSAGES["ja"].accounts).get("play.visibility.followers")).toBe("自分のフォロワーのみ");
    // 遊戲追蹤按鈕用「追蹤／Follow／フォロー」，兩者不同字
    expect(flattenMessages(MESSAGES["zh-Hant"].accounts).get("follow.button")).toBe("追蹤");
  });
});

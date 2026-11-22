/**
 * Steam appdetails 對 Metacritic 頁面的記錄（配對佐證）：URL 解析、無記錄／出錯／限流都回「未知」、快取與間隔。
 */
import { describe, expect, it } from "vitest";
import { createSteamHintClient, metacriticSlugFromUrl } from "@/modules/metacritic/provider/steam";

describe("metacriticSlugFromUrl", () => {
  it("支援 /game/<slug>/ 與 Steam 常給的 /game/pc/<slug>?ftag=…", () => {
    expect(metacriticSlugFromUrl("https://www.metacritic.com/game/pc/onimusha-way-of-the-sword?ftag=MCD-06-10aaa1f")).toBe("onimusha-way-of-the-sword");
    expect(metacriticSlugFromUrl("https://www.metacritic.com/game/butchers-creek/")).toBe("butchers-creek");
  });
  it("不是 Metacritic 遊戲頁（別的網域、電影、缺 slug、亂字元）→ null", () => {
    for (const u of ["https://example.com/game/x/", "https://www.metacritic.com/movie/x/", "https://www.metacritic.com/game/", "https://www.metacritic.com/game/a/b/c/", "https://www.metacritic.com/game/Bad_Slug/", "not a url"]) {
      expect(metacriticSlugFromUrl(u)).toBeNull();
    }
  });
});

const steamBody = (appId: string, data: unknown, success = true) => JSON.stringify({ [appId]: { success, data } });
function mkClient(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const client = createSteamHintClient({
    fetchImpl: (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return handler(String(input));
    }) as typeof fetch,
    sleep: async () => {},
    minIntervalMs: 0,
  });
  return { client, calls };
}

describe("createSteamHintClient", () => {
  it("有 Metacritic 記錄 → 回 slug；請求只帶 metacritic 篩選", async () => {
    const { client, calls } = mkClient(() => new Response(steamBody("42", { metacritic: { score: 83, url: "https://www.metacritic.com/game/pc/some-game?ftag=x" } })));
    expect(await client.getMetacriticSlug("42")).toBe("some-game");
    expect(calls[0]).toContain("appids=42");
    expect(calls[0]).toContain("filters=metacritic");
  });
  it("Steam 沒有記錄（data 為空陣列／沒有 metacritic 欄位）→ null", async () => {
    const empty = mkClient(() => new Response(steamBody("7", [])));
    expect(await empty.client.getMetacriticSlug("7")).toBeNull();
    const none = mkClient(() => new Response(steamBody("8", {})));
    expect(await none.client.getMetacriticSlug("8")).toBeNull();
  });
  it("success=false、非 200、壞 JSON、網路錯誤 → undefined（未知），不丟例外", async () => {
    expect(await mkClient(() => new Response(steamBody("1", {}, false))).client.getMetacriticSlug("1")).toBeUndefined();
    expect(await mkClient(() => new Response("oops", { status: 500 })).client.getMetacriticSlug("1")).toBeUndefined();
    expect(await mkClient(() => new Response("not json")).client.getMetacriticSlug("1")).toBeUndefined();
    expect(await mkClient(() => Promise.reject(new Error("net"))).client.getMetacriticSlug("1")).toBeUndefined();
  });
  it("非數字的 AppID 不發請求", async () => {
    const { client, calls } = mkClient(() => new Response("{}"));
    expect(await client.getMetacriticSlug("12; drop")).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
  it("同一個 AppID 只問一次（快取）；被限流（429）後本輪不再問任何 AppID", async () => {
    const ok = mkClient(() => new Response(steamBody("5", { metacritic: { url: "https://www.metacritic.com/game/g/" } })));
    await ok.client.getMetacriticSlug("5");
    await ok.client.getMetacriticSlug("5");
    expect(ok.calls).toHaveLength(1);
    const limited = mkClient(() => new Response("slow down", { status: 429 }));
    expect(await limited.client.getMetacriticSlug("1")).toBeUndefined();
    expect(await limited.client.getMetacriticSlug("2")).toBeUndefined();
    expect(limited.calls).toHaveLength(1);
  });
  it("兩次請求之間會等 minIntervalMs", async () => {
    const waits: number[] = [];
    const client = createSteamHintClient({
      fetchImpl: (async () => new Response(steamBody("1", []))) as typeof fetch,
      sleep: async (ms) => void waits.push(ms),
      minIntervalMs: 60_000,
    });
    await client.getMetacriticSlug("1");
    await client.getMetacriticSlug("2");
    expect(waits.length).toBeGreaterThanOrEqual(1);
    expect(waits.at(-1)!).toBeGreaterThan(0);
  });
});

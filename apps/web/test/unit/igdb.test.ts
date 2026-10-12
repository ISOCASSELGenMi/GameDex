/**
 * Phase 2a：IGDB Provider（日期正規化、對照表、節流、token 快取、查詢重試）與 sync_platforms 的純邏輯。
 * 不連 IGDB：fetch、時鐘、sleep 全部注入假的。
 */
import { describe, expect, it, vi } from "vitest";
import type { PlatformReleaseDateRecord } from "@/modules/catalog/domain/entities";
import { IgdbClient, IgdbError, TwitchTokenCache, toPlatformRecord } from "@/modules/catalog/providers/igdb";
import { normalizeIgdbDate } from "@/modules/catalog/providers/igdb/dates";
import { igdbImageUrl, mapPlatformKind, mapReleaseRegion } from "@/modules/catalog/providers/igdb/mappings";
import { RequestLimiter, Semaphore, TokenBucket } from "@/modules/catalog/providers/igdb/throttle";
import { pickEarliestPerRegion, pickOriginalVersionDates } from "@/modules/catalog/use-cases/sync/sync-platforms";

const ts = (iso: string) => Date.parse(iso) / 1000;

/** 虛擬時鐘：sleep 直接推進時間。 */
function virtualClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("normalizeIgdbDate（04 §日期正規化）", () => {
  it("0 YYYYMMDD：取 UTC 日期（台灣時間已是隔天也不跟著跳）", () => {
    expect(normalizeIgdbDate(ts("2021-02-28T23:30:00Z"), 0)).toEqual({
      releaseDate: "2021-02-28",
      periodStart: "2021-02-28",
      precision: "day",
    });
  });
  it("1 YYYYMM：當月第一天", () => {
    expect(normalizeIgdbDate(ts("2024-02-15T00:00:00Z"), 1)).toEqual({
      releaseDate: "2024-02-01",
      periodStart: "2024-02-01",
      precision: "month",
    });
  });
  it("2 YYYY：代表日 12/31、期間起 1/1", () => {
    expect(normalizeIgdbDate(ts("2025-07-01T00:00:00Z"), 2)).toEqual({
      releaseDate: "2025-12-31",
      periodStart: "2025-01-01",
      precision: "year",
    });
  });
  it("3~6 季：季別看 date_format、年份看 date，代表日為季末", () => {
    const d = ts("2026-01-01T00:00:00Z");
    expect(normalizeIgdbDate(d, 3)).toEqual({ releaseDate: "2026-03-31", periodStart: "2026-01-01", precision: "quarter" });
    expect(normalizeIgdbDate(d, 4)).toEqual({ releaseDate: "2026-06-30", periodStart: "2026-04-01", precision: "quarter" });
    expect(normalizeIgdbDate(d, 5)).toEqual({ releaseDate: "2026-09-30", periodStart: "2026-07-01", precision: "quarter" });
    expect(normalizeIgdbDate(d, 6)).toEqual({ releaseDate: "2026-12-31", periodStart: "2026-10-01", precision: "quarter" });
  });
  it("7 TBD、date 缺漏 → tbd", () => {
    const tbd = { releaseDate: null, periodStart: null, precision: "tbd" };
    expect(normalizeIgdbDate(ts("2026-01-01T00:00:00Z"), 7)).toEqual(tbd);
    expect(normalizeIgdbDate(null, 0)).toEqual(tbd);
    expect(normalizeIgdbDate(undefined, 2)).toEqual(tbd);
  });
  it("未知 date_format → tbd 並回報", () => {
    const onUnknown = vi.fn();
    expect(normalizeIgdbDate(ts("2026-01-01T00:00:00Z"), 99, onUnknown).precision).toBe("tbd");
    expect(onUnknown).toHaveBeenCalledWith(99);
  });
});

describe("IGDB 對照表", () => {
  it("release_region：4 紐西蘭併入 AU，未知 → WW", () => {
    expect(mapReleaseRegion(2)).toBe("US");
    expect(mapReleaseRegion(5)).toBe("JP");
    expect(mapReleaseRegion(4)).toBe("AU");
    expect(mapReleaseRegion(42)).toBe("WW");
    expect(mapReleaseRegion(undefined)).toBe("WW");
  });
  it("平台種類：覆寫表優先於 platform_type", () => {
    expect(mapPlatformKind(167, 1)).toEqual({ kind: "console", unmapped: false }); // PS5
    expect(mapPlatformKind(37, 5)).toEqual({ kind: "handheld", unmapped: false }); // 3DS
    expect(mapPlatformKind(130, 1)).toEqual({ kind: "hybrid", unmapped: false }); // Switch
    expect(mapPlatformKind(34, 4)).toEqual({ kind: "mobile", unmapped: false }); // Android
    expect(mapPlatformKind(6, 4)).toEqual({ kind: "pc", unmapped: false }); // Windows
  });
  it("未列入覆寫表的 Operating_system、未知或缺 platform_type → other 並標 unmapped", () => {
    expect(mapPlatformKind(99999, 4)).toEqual({ kind: "other", unmapped: true });
    expect(mapPlatformKind(99999, 77)).toEqual({ kind: "other", unmapped: true });
    expect(mapPlatformKind(99999, undefined)).toEqual({ kind: "other", unmapped: true });
  });
  it("圖片 URL", () => {
    expect(igdbImageUrl("abc")).toBe("https://images.igdb.com/igdb/image/upload/t_logo_med/abc.png");
    expect(igdbImageUrl(undefined)).toBeNull();
  });
});

describe("toPlatformRecord", () => {
  it("轉成 Domain 型別：家族、logo、各版本上市日攤平、空字串轉 null", () => {
    const warn = vi.fn();
    const rec = toPlatformRecord(
      {
        id: 167,
        name: "PlayStation 5",
        slug: "ps5",
        abbreviation: "PS5",
        alternative_name: "",
        platform_type: 1,
        generation: 9,
        platform_logo: { image_id: "plmk" },
        platform_family: { id: 1, name: "PlayStation", slug: "playstation" },
        versions: [
          {
            platform_version_release_dates: [
              { date: ts("2020-11-12T00:00:00Z"), date_format: 0, release_region: 2 },
              { date: ts("2020-11-19T00:00:00Z"), date_format: 0, release_region: 1 },
            ],
          },
          { platform_version_release_dates: [{ date: ts("2024-11-07T00:00:00Z"), date_format: 0, release_region: 2 }] },
        ],
      },
      warn,
    );
    expect(rec).toMatchObject({
      igdbId: 167,
      name: "PlayStation 5",
      slug: "ps5",
      abbreviation: "PS5",
      alternativeName: null,
      kind: "console",
      generation: 9,
      family: { igdbId: 1, name: "PlayStation", slug: "playstation" },
      logoUrl: "https://images.igdb.com/igdb/image/upload/t_logo_med/plmk.png",
      summary: null,
    });
    expect(rec.versions.map((v) => v.releaseDates.map((d) => [d.regionCode, d.releaseDate]))).toEqual([
      [
        ["US", "2020-11-12"],
        ["EU", "2020-11-19"],
      ],
      [["US", "2024-11-07"]],
    ]);
    expect(warn).not.toHaveBeenCalled();
  });
  it("缺欄位不失敗：補名稱、slug，未對照種類記警告", () => {
    const warn = vi.fn();
    const rec = toPlatformRecord({ id: 777 }, warn);
    expect(rec).toMatchObject({ name: "Platform 777", slug: "platform-777", kind: "other", family: null, versions: [] });
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("pickEarliestPerRegion", () => {
  const rd = (regionCode: string, periodStart: string | null, precision: PlatformReleaseDateRecord["precision"]) => ({
    regionCode,
    periodStart,
    releaseDate: periodStart,
    precision,
  });

  it("同地區取最早；不同地區各留一筆", () => {
    const out = pickEarliestPerRegion([
      rd("US", "2024-11-07", "day"),
      rd("US", "2020-11-12", "day"),
      rd("JP", "2020-11-12", "day"),
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((d) => d.regionCode === "US")?.periodStart).toBe("2020-11-12");
  });
  it("tbd 只在沒有其他日期時保留；同一天精度細者優先", () => {
    expect(pickEarliestPerRegion([rd("US", null, "tbd"), rd("US", "2021-01-01", "year")])[0].precision).toBe("year");
    expect(pickEarliestPerRegion([rd("US", "2021-01-01", "year"), rd("US", null, "tbd")])[0].precision).toBe("year");
    expect(pickEarliestPerRegion([rd("US", "2021-01-01", "year"), rd("US", "2021-01-01", "day")])[0].precision).toBe("day");
    expect(pickEarliestPerRegion([rd("US", null, "tbd")])[0].precision).toBe("tbd");
  });
});

describe("pickOriginalVersionDates", () => {
  const d = (regionCode: string, date: string | null) => ({
    regionCode,
    periodStart: date,
    releaseDate: date,
    precision: date === null ? ("tbd" as const) : ("day" as const),
  });
  const codes = (out: PlatformReleaseDateRecord[]) =>
    Object.fromEntries(out.map((x) => [x.regionCode, x.periodStart] as const));

  it("只採含最早日期的版本：改版機的 WW 不混入（PS5 Pro 實例）", () => {
    const out = pickOriginalVersionDates([
      { releaseDates: [d("US", "2020-11-12"), d("EU", "2020-11-19")] },
      { releaseDates: [d("WW", "2024-11-07")] },
    ]);
    expect(codes(out)).toEqual({ US: "2020-11-12", EU: "2020-11-19" });
  });
  it("版本順序不影響；原版沒有的地區不從改版機補", () => {
    const out = pickOriginalVersionDates([
      { releaseDates: [d("US", "2004-10-29"), d("BR", "2009-10-15")] },
      { releaseDates: [d("JP", "2000-03-04"), d("US", "2000-10-26")] },
    ]);
    expect(codes(out)).toEqual({ JP: "2000-03-04", US: "2000-10-26" });
  });
  it("多個版本並列最早時一起採用，同地區仍取最早", () => {
    const out = pickOriginalVersionDates([
      { releaseDates: [d("WW", "2020-11-10")] },
      { releaseDates: [d("WW", "2020-11-10"), d("JP", "2020-11-10")] },
      { releaseDates: [] },
    ]);
    expect(codes(out)).toEqual({ WW: "2020-11-10", JP: "2020-11-10" });
  });
  it("沒有日期 → 空；全是 tbd 時保留 tbd", () => {
    expect(pickOriginalVersionDates([])).toEqual([]);
    expect(pickOriginalVersionDates([{ releaseDates: [] }])).toEqual([]);
    expect(codes(pickOriginalVersionDates([{ releaseDates: [d("WW", null)] }]))).toEqual({ WW: null });
  });
});

describe("節流", () => {
  it("TokenBucket 4/s：請求間隔 250ms，依呼叫順序", async () => {
    const clock = virtualClock();
    const bucket = new TokenBucket(4, 1, clock.now, clock.sleep);
    const times: number[] = [];
    await Promise.all(Array.from({ length: 5 }, () => bucket.acquire().then(() => times.push(clock.now()))));
    expect(times).toEqual([0, 250, 500, 750, 1000]);
  });
  it("TokenBucket 閒置後只存 burst 個，不會累積爆量", async () => {
    const clock = virtualClock();
    const bucket = new TokenBucket(4, 1, clock.now, clock.sleep);
    await clock.sleep(10_000);
    const start = clock.now();
    await bucket.acquire();
    await bucket.acquire();
    expect(clock.now() - start).toBe(250);
  });
  it("RequestLimiter：同時最多 8 個，名額依序遞補", async () => {
    const limiter = new RequestLimiter([], 8);
    const gates = Array.from({ length: 20 }, deferred);
    let peak = 0;
    const runs = gates.map((g) =>
      limiter.run(async () => {
        peak = Math.max(peak, limiter.inFlight);
        await g.promise;
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(limiter.inFlight).toBe(8);
    gates.forEach((g) => g.resolve());
    await Promise.all(runs);
    expect(peak).toBe(8);
    expect(limiter.inFlight).toBe(0);
  });
  it("RequestLimiter：fn 丟錯也釋放名額", async () => {
    const limiter = new RequestLimiter([], 1);
    await expect(limiter.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(limiter.inFlight).toBe(0);
    await expect(limiter.run(async () => "ok")).resolves.toBe("ok");
  });
  it("withExtraBucket 共用同一個 semaphore", async () => {
    const sem = new Semaphore(1);
    const base = new RequestLimiter([], sem);
    const extra = base.withExtraBucket(new TokenBucket(1000));
    const gate = deferred();
    const first = base.run(() => gate.promise);
    await new Promise((r) => setTimeout(r, 0));
    expect(extra.inFlight).toBe(1);
    gate.resolve();
    await first;
    expect(extra.inFlight).toBe(0);
  });
});

const SECRET = "s3cr3t-value";
const tokenResponse = (token: string, expiresIn = 5_000_000) =>
  new Response(JSON.stringify({ access_token: token, expires_in: expiresIn, token_type: "bearer" }), { status: 200 });

describe("TwitchTokenCache", () => {
  it("快取 token；同時多個 get() 只取一次", async () => {
    const fetchImpl = vi.fn(async () => tokenResponse("t1"));
    const cache = new TwitchTokenCache("cid", SECRET, fetchImpl as unknown as typeof fetch);
    const tokens = await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(tokens).toEqual(["t1", "t1", "t1"]);
    expect(await cache.get()).toBe("t1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("到期前 margin 秒就重新取得", async () => {
    let t = 0;
    let n = 0;
    const fetchImpl = vi.fn(async () => tokenResponse(`t${++n}`, 1000));
    const cache = new TwitchTokenCache("cid", SECRET, fetchImpl as unknown as typeof fetch, () => t, 300);
    expect(await cache.get()).toBe("t1");
    t = 699_000;
    expect(await cache.get()).toBe("t1");
    t = 700_000;
    expect(await cache.get()).toBe("t2");
  });
  it("invalidate 只清掉同一個 token", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => tokenResponse(`t${++n}`));
    const cache = new TwitchTokenCache("cid", SECRET, fetchImpl as unknown as typeof fetch);
    await cache.get();
    cache.invalidate("other");
    expect(await cache.get()).toBe("t1");
    cache.invalidate("t1");
    expect(await cache.get()).toBe("t2");
  });
  it("Secret 不放 URL，失敗訊息不含 Secret", async () => {
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      new Response('{"status":400,"message":"invalid client secret"}', { status: 400 }),
    );
    const cache = new TwitchTokenCache("cid", SECRET, fetchImpl as unknown as typeof fetch);
    const err = await cache.get().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IgdbError);
    expect(String((err as Error).message)).not.toContain(SECRET);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).not.toContain(SECRET);
    expect(String(init?.body)).toContain("client_credentials");
  });
});

describe("IgdbClient", () => {
  type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

  function makeClient(apiHandler: Handler) {
    let tokenN = 0;
    const apiCalls: Array<{ url: string; auth: string; body: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes("id.twitch.tv")) return tokenResponse(`tok${++tokenN}`);
      const headers = init.headers as Record<string, string>;
      apiCalls.push({ url, auth: headers.Authorization, body: String(init.body) });
      return apiHandler(url, init);
    });
    const sleep = vi.fn(async () => {});
    const client = new IgdbClient({
      clientId: "cid",
      tokens: new TwitchTokenCache("cid", SECRET, fetchImpl as unknown as typeof fetch),
      limiter: new RequestLimiter([], 8),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
    });
    return { client, apiCalls, sleep, tokenCount: () => tokenN };
  }

  it("帶 Client-ID 與 Bearer token POST 到 /v4/{endpoint}", async () => {
    const { client, apiCalls } = makeClient(() => new Response('[{"id":1}]'));
    expect(await client.query("platforms", "fields name;")).toEqual([{ id: 1 }]);
    expect(apiCalls[0]).toEqual({ url: "https://api.igdb.com/v4/platforms", auth: "Bearer tok1", body: "fields name;" });
  });
  it("401 → 換新 token 重試一次", async () => {
    let n = 0;
    const { client, apiCalls, tokenCount } = makeClient(() =>
      ++n === 1 ? new Response("unauthorized", { status: 401 }) : new Response("[]"),
    );
    expect(await client.query("platforms", "fields name;")).toEqual([]);
    expect(tokenCount()).toBe(2);
    expect(apiCalls.map((c) => c.auth)).toEqual(["Bearer tok1", "Bearer tok2"]);
  });
  it("連續 401 不會無限重試", async () => {
    const { client } = makeClient(() => new Response("unauthorized", { status: 401 }));
    await expect(client.query("platforms", "x")).rejects.toMatchObject({ name: "IgdbError", status: 401 });
  });
  it("429 依 Retry-After 等待後重試；5xx 指數退避", async () => {
    const responses = [
      new Response("slow down", { status: 429, headers: { "retry-after": "2" } }),
      new Response("oops", { status: 503 }),
      new Response('[{"id":9}]'),
    ];
    const { client, sleep } = makeClient(() => responses.shift()!);
    expect(await client.query("games", "x")).toEqual([{ id: 9 }]);
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([2000, 1000]);
  });
  it("重試用完 → IgdbError；4xx 不重試", async () => {
    const a = makeClient(() => new Response("down", { status: 500 }));
    await expect(a.client.query("games", "x")).rejects.toMatchObject({ status: 500 });
    expect(a.apiCalls).toHaveLength(4);

    const b = makeClient(() => new Response('[{"title":"Syntax Error"}]', { status: 400 }));
    await expect(b.client.query("games", "x")).rejects.toMatchObject({ status: 400, endpoint: "games" });
    expect(b.apiCalls).toHaveLength(1);
  });
  it("queryAll 以 id 游標分頁直到不足一頁", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => ({ id: i + 1 }));
    const { client, apiCalls } = makeClient((_url, init) =>
      new Response(JSON.stringify(String(init.body).includes("id > 0") ? page1 : [{ id: 501 }, { id: 502 }])),
    );
    const all = await client.queryAll<{ id: number }>("platforms", "name", "platform_type = 1");
    expect(all).toHaveLength(502);
    expect(apiCalls.map((c) => c.body)).toEqual([
      "fields name; where id > 0 & (platform_type = 1); sort id asc; limit 500;",
      "fields name; where id > 500 & (platform_type = 1); sort id asc; limit 500;",
    ]);
  });
});

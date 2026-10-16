/** accounts e2e 共用：註冊／API 登入／帶 Origin 的 API 呼叫／直接寫測試資料庫的 seed（不連外部服務）。 */
import pg from "pg";
import { request as pwRequest, type Page } from "@playwright/test";
import { E2E_BASE_URL, testDatabaseUrl } from "./env";
import { expect } from "./helpers";

export const PASSWORD = "e2e long password 1";
const RUN = Date.now().toString(36);
let seq = 0;
export const uniqueEmail = (tag: string): string => `e2e-w5-${tag}-${RUN}-${seq++}@example.com`;

/** 以獨立的 request context 註冊（它的 Cookie 不影響測試用的 page）。 */
export async function register(email: string, name: string): Promise<void> {
  const ctx = await pwRequest.newContext();
  try {
    const res = await ctx.post(`${E2E_BASE_URL}/api/v1/auth/sign-up/email`, { headers: { origin: E2E_BASE_URL }, data: { email, password: PASSWORD, name } });
    expect(res.status(), `註冊 ${email}`).toBe(200);
  } finally {
    await ctx.dispose();
  }
}

/** 用 API 登入（Cookie 進該 page 的 context）。 */
export async function apiLogin(page: Page, email: string): Promise<void> {
  const res = await page.request.post("/api/v1/auth/sign-in/email", { headers: { origin: E2E_BASE_URL }, data: { email, password: PASSWORD } });
  expect(res.status(), `登入 ${email}`).toBe(200);
}

/** 註冊並登入，回傳信箱。 */
export async function signedInUser(page: Page, tag: string, name = `W5 ${tag}`): Promise<string> {
  const email = uniqueEmail(tag);
  await register(email, name);
  await apiLogin(page, email);
  return email;
}

/** 帶 Origin 的寫入呼叫（POST／PATCH／DELETE），回傳 JSON。 */
export async function api<T = unknown>(page: Page, method: "POST" | "PATCH" | "DELETE" | "GET", url: string, data?: unknown): Promise<{ status: number; json: T }> {
  const res = await page.request.fetch(url, { method, headers: { origin: E2E_BASE_URL }, ...(data === undefined ? {} : { data }) });
  const text = await res.text();
  return { status: res.status(), json: (text ? JSON.parse(text) : null) as T };
}

export async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function gameIdBySlug(slug: string): Promise<number> {
  return withDb(async (c) => {
    const { rows } = await c.query<{ id: number }>("SELECT id FROM games WHERE slug = $1", [slug]);
    if (!rows[0]) throw new Error(`fixture 沒有遊戲 ${slug}`);
    return rows[0].id;
  });
}

/** 玩家平均（job 在 e2e 不執行，直接寫 game_player_ratings）。avgHalfSteps＝半分級平均（17＝8.5 分）。 */
export async function seedPlayerRating(slug: string, row: { ratingCount: number; avgHalfSteps: number | null; avgPlayMinutes: number | null }): Promise<void> {
  const id = await gameIdBySlug(slug);
  await withDb((c) =>
    c.query(
      `INSERT INTO game_player_ratings (game_id, avg_half_steps, rating_count, avg_play_minutes) VALUES ($1,$2,$3,$4)
       ON CONFLICT (game_id) DO UPDATE SET avg_half_steps = EXCLUDED.avg_half_steps, rating_count = EXCLUDED.rating_count, avg_play_minutes = EXCLUDED.avg_play_minutes`,
      [id, row.avgHalfSteps, row.ratingCount, row.avgPlayMinutes],
    ),
  );
}

/** 為信箱建立 Steam 綁定與 owned_games：已比對 1、待確認 1（有可比對的標題）、找不到 1、待確認 1（無候選）。 */
export async function seedManualSteam(email: string, heroSlug: string): Promise<void> {
  await withDb(async (client) => {
    const steamId = `76561198${(Date.now() % 100_000_000).toString().padStart(8, "0")}${seq++ % 10}`;
    const { rows: u } = await client.query<{ id: number }>("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    const { rows: a } = await client.query<{ id: number }>("INSERT INTO connected_accounts (user_id, provider, provider_account_id) VALUES ($1, 'steam', $2) RETURNING id", [u[0]!.id, steamId]);
    const { rows: g } = await client.query<{ id: number }>("SELECT id FROM games WHERE slug = $1", [heroSlug]);
    const acct = a[0]!.id;
    const insert = (appId: string, title: string, gameId: number | null, pct: number | null) =>
      client.query("INSERT INTO owned_games (connected_account_id, external_game_id, external_title, matched_game_id, match_confidence_pct) VALUES ($1,$2,$3,$4,$5)", [acct, appId, title, gameId, pct]);
    await insert("3001", "Already Matched Game", g[0]!.id, 100);
    await insert("3002", "Aurora Odyssey Special Edition", null, 70);
    await insert("3003", "Nowhere Title", null, 0);
    await insert("3004", "Zzz Unknown Soundtrack", null, 65);
  });
}

/** 水平溢出（px）。 */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** 第 6 波：各種追蹤目標的 id（fixture 以 slug 查）。table 只接受固定清單。 */
export async function targetIdBySlug(table: "games" | "events" | "platforms" | "franchises" | "companies", slug: string): Promise<number> {
  return withDb(async (c) => {
    const { rows } = await c.query<{ id: number }>(`SELECT id FROM ${table} WHERE slug = $1 ORDER BY id LIMIT 1`, [slug]);
    if (!rows[0]) throw new Error(`fixture 沒有 ${table}:${slug}`);
    return rows[0].id;
  });
}

export async function userIdByEmail(email: string): Promise<number> {
  return withDb(async (c) => {
    const { rows } = await c.query<{ id: number }>("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (!rows[0]) throw new Error(`沒有使用者 ${email}`);
    return rows[0].id;
  });
}

/** 站內追蹤熱度訊號（refresh_popularity 在 e2e 不執行，直接寫 game_popularity_signals）。 */
export async function seedFollowSignals(slug: string, signals: { siteFollows: number; siteFollows7d: number }): Promise<void> {
  const id = await gameIdBySlug(slug);
  await withDb(async (c) => {
    for (const [name, value] of [["site_follows", signals.siteFollows], ["site_follows_7d", signals.siteFollows7d]] as const) {
      await c.query(
        "INSERT INTO game_popularity_signals (game_id, signal_name, value) VALUES ($1,$2,$3) ON CONFLICT (game_id, signal_name) DO UPDATE SET value = EXCLUDED.value",
        [id, name, value],
      );
    }
  });
}

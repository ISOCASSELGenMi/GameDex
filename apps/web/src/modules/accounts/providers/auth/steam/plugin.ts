/**
 * Steam 登入／綁定的 Better Auth plugin（09 §登入與綁定；K 報告 §(d)）。
 * - `POST {basePath}/steam/sign-in`：回 `{ url }`（前端再導向 Steam）。有 session ＝ 綁定，沒有 ＝ 登入。走 BA 的 origin 檢查。
 * - `GET  {basePath}/steam/callback`：Steam 只會用 GET 回來。驗證全部通過才建立／綁定。
 * - 註冊關閉（signupEnabled=false）：沒有對應帳號的 SteamID 不建新使用者，導回 error=signup_disabled；已綁定者照常登入。
 * - callbackURL／errorCallbackURL 只接受站內相對路徑；錯誤時 302 到 errorCallbackURL 並附 `?error=<code>`。
 */
import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { DEFAULT_LOCALE } from "@sok/i18n";
import * as z from "zod";
import { placeholderEmail } from "../../../domain/entities/email";
import { safeRelativePath, withQueryParam } from "../../../domain/entities/safe-path";
import { buildSteamAuthUrl, STEAM_PROVIDER_ID, verifySteamAssertion } from "./openid";

const STATE_COOKIE = "steam_openid_state";
export const STEAM_RATE_LIMIT = { max: 20, window: 60 } as const;

/** Steam 流程的錯誤碼（附在 errorCallbackURL 的 ?error=）。 */
export const STEAM_ERROR_CODES = ["steam_invalid_response", "steam_verification_failed", "steam_already_linked", "steam_network_error", "signup_disabled"] as const;
export type SteamErrorCode = (typeof STEAM_ERROR_CODES)[number];

export interface SteamProfile {
  name: string;
  image?: string;
}

export interface SteamPluginOptions {
  signupEnabled: boolean;
  /** 注入 fetch（測試用假的 Steam 回應）。 */
  fetch?: typeof fetch;
  /** 暱稱／頭像（GetPlayerSummaries；需要 STEAM_WEB_API_KEY）；沒有或失敗就用「Steam <id>」。 */
  fetchProfile?: (steamId: string) => Promise<SteamProfile | null>;
}

export const defaultSteamCallbackPath = () => `/${DEFAULT_LOCALE}/account`;

const signInBody = z.object({ callbackURL: z.string().max(2048).optional(), errorCallbackURL: z.string().max(2048).optional() }).optional();

interface SteamState {
  n: string;
  link: string | null;
  cb: string;
  err: string;
}

function failureCode(reason: string): SteamErrorCode {
  if (reason === "network") return "steam_network_error";
  if (reason === "not_valid") return "steam_verification_failed";
  return "steam_invalid_response";
}

export const steam = (opts: SteamPluginOptions) => {
  const doFetch: typeof fetch = (...args) => (opts.fetch ?? fetch)(...args);
  return {
    id: "steam",
    endpoints: {
      signInSteam: createAuthEndpoint("/steam/sign-in", { method: "POST", body: signInBody }, async (ctx) => {
        const session = await getSessionFromCtx(ctx).catch(() => null);
        const nonce = crypto.randomUUID();
        const fallback = defaultSteamCallbackPath();
        const state: SteamState = {
          n: nonce,
          link: session?.user.id ?? null,
          cb: safeRelativePath(ctx.body?.callbackURL, fallback),
          err: safeRelativePath(ctx.body?.errorCallbackURL, fallback),
        };
        const c = ctx.context.createAuthCookie(STATE_COOKIE, { maxAge: 600 });
        await ctx.setSignedCookie(c.name, JSON.stringify(state), ctx.context.secret, c.attributes);
        const returnTo = `${ctx.context.baseURL}/steam/callback?n=${nonce}`;
        return ctx.json({ url: buildSteamAuthUrl(returnTo, new URL(ctx.context.baseURL).origin) });
      }),
      steamCallback: createAuthEndpoint("/steam/callback", { method: "GET", metadata: { isAction: false } }, async (ctx) => {
        const c = ctx.context.createAuthCookie(STATE_COOKIE);
        const raw = await ctx.getSignedCookie(c.name, ctx.context.secret);
        let state: SteamState | null = null;
        try {
          const parsed = raw ? (JSON.parse(raw) as Partial<SteamState>) : null;
          if (parsed && typeof parsed.n === "string") {
            state = {
              n: parsed.n,
              link: typeof parsed.link === "string" ? parsed.link : null,
              cb: safeRelativePath(parsed.cb, defaultSteamCallbackPath()),
              err: safeRelativePath(parsed.err, defaultSteamCallbackPath()),
            };
          }
        } catch {
          state = null;
        }
        const errorTarget = state?.err ?? defaultSteamCallbackPath();
        const fail = (code: SteamErrorCode): never => {
          // state 一次性：不論成敗都清掉
          ctx.setCookie(c.name, "", { ...c.attributes, maxAge: 0 });
          throw ctx.redirect(withQueryParam(errorTarget, "error", code));
        };
        if (!state) return fail("steam_invalid_response");
        const query = Object.fromEntries(new URL(ctx.request!.url).searchParams) as Record<string, string>;
        if (query.n !== state.n) return fail("steam_invalid_response");
        const returnTo = `${ctx.context.baseURL}/steam/callback?n=${state.n}`;
        const v = await verifySteamAssertion(query, returnTo, doFetch);
        if (!v.ok) return fail(failureCode(v.reason));
        ctx.setCookie(c.name, "", { ...c.attributes, maxAge: 0 });

        const key = { providerId: STEAM_PROVIDER_ID, accountId: v.steamId };
        if (state.link) {
          // 綁定：已登入者把 Steam 加進自己的帳號；已屬於別人 → 拒絕
          const owner = await ctx.context.internalAdapter.findAccountOwnerByKey(key);
          if (owner?.kind === "owned" && String(owner.user.id) !== String(state.link)) return fail("steam_already_linked");
          if (owner?.kind === "orphaned") return fail("steam_invalid_response");
          if (!owner) await ctx.context.internalAdapter.linkAccount({ userId: state.link, ...key });
          throw ctx.redirect(state.cb);
        }

        // 登入：只有新使用者才需要暱稱；已綁定者不打 Steam API
        const existing = await ctx.context.internalAdapter.findAccountOwnerByKey(key);
        if (!existing && !opts.signupEnabled) return fail("signup_disabled");
        const profile = existing ? null : ((await opts.fetchProfile?.(v.steamId).catch(() => null)) ?? null);
        const result = await handleOAuthUserInfo(ctx, {
          userInfo: {
            id: v.steamId,
            name: profile?.name ?? `Steam ${v.steamId}`,
            image: profile?.image,
            // Steam 不給信箱：用 placeholder（D77）；emailVerified=false，不會被隱式綁到同信箱的既有帳號
            email: placeholderEmail(v.steamId, STEAM_PROVIDER_ID),
            emailVerified: false,
          },
          account: { ...key, scope: "openid" },
          callbackURL: state.cb,
          disableSignUp: !opts.signupEnabled,
        });
        if (result.error === "signup disabled") return fail("signup_disabled");
        if (result.error || !result.data) return fail("steam_invalid_response");
        await setSessionCookie(ctx, { session: result.data.session, user: result.data.user });
        throw ctx.redirect(state.cb);
      }),
    },
    rateLimit: [{ pathMatcher: (p: string) => p.startsWith("/steam/"), ...STEAM_RATE_LIMIT }],
  } satisfies BetterAuthPlugin;
};

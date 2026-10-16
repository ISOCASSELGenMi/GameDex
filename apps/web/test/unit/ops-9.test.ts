import { describe, expect, it, vi } from "vitest";
import type { SyncStateRow } from "@/kernel/db/sync-state";
import { buildErrorLogLine, moduleFromRoutePath } from "@/kernel/observability/report";
import { FILTERED, FILTERED_EMAIL, scrubEvent, scrubString } from "@/kernel/observability/scrub";
import { cronMaxIntervalMs, parseCron } from "@/kernel/scheduler/cron-interval";
import {
  ALERT_DEDUPE_MS,
  checkHeartbeats,
  findHeartbeatProblems,
  formatHeartbeatAlert,
  type MonitoredJob,
} from "@/kernel/scheduler/heartbeat";

const H = 3_600_000;

describe("cronMaxIntervalMs（預期間隔）", () => {
  it.each([
    ["10 * * * *", 1 * H],
    ["25 */6 * * *", 6 * H],
    ["20 4 * * *", 24 * H],
    ["30 3 * * *", 24 * H],
    ["*/10 * * * *", 10 * 60_000],
    ["0 4 * * 1", 7 * 24 * H],
    ["0 4 1 * *", 31 * 24 * H],
    ["0 0,12 * * *", 12 * H],
  ])("%s", (expr, expected) => {
    expect(cronMaxIntervalMs(expr)).toBe(expected);
  });

  it("無效表示式回 null", () => {
    expect(cronMaxIntervalMs("not a cron")).toBeNull();
    expect(cronMaxIntervalMs("61 * * * *")).toBeNull();
    expect(cronMaxIntervalMs("* * * *")).toBeNull();
    expect(parseCron("*/0 * * * *")).toBeNull();
  });
});

function row(over: Partial<SyncStateRow> & { jobName: string }): SyncStateRow {
  return {
    lastSyncedAt: null,
    cursor: null,
    meta: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    consecutiveFailures: 0,
    lastAlertedAt: null,
    updatedAt: null,
    ...over,
  };
}

const NOW = new Date("2026-10-15T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const JOBS: MonitoredJob[] = [
  { name: "hourly", cron: "10 * * * *" },
  { name: "daily", cron: "20 4 * * *" },
];

describe("心跳規則（純函式）", () => {
  it("正常：最近成功、沒有失敗 → 無問題", () => {
    const rows = [row({ jobName: "hourly", lastSuccessAt: ago(1.5 * H) }), row({ jobName: "daily", lastSuccessAt: ago(20 * H) })];
    expect(findHeartbeatProblems(JOBS, rows, NOW)).toEqual([]);
  });

  it("逾期：超過 2 × 預期間隔沒成功（每小時任務 2.5 小時；每日任務 49 小時）", () => {
    const rows = [row({ jobName: "hourly", lastSuccessAt: ago(2.5 * H) }), row({ jobName: "daily", lastSuccessAt: ago(49 * H) })];
    const problems = findHeartbeatProblems(JOBS, rows, NOW);
    expect(problems.map((p) => [p.job, p.kind])).toEqual([
      ["hourly", "overdue"],
      ["daily", "overdue"],
    ]);
  });

  it("剛好 2 倍不算逾期；每日任務 47 小時前成功仍正常", () => {
    const rows = [row({ jobName: "hourly", lastSuccessAt: ago(2 * H) }), row({ jobName: "daily", lastSuccessAt: ago(47 * H) })];
    expect(findHeartbeatProblems(JOBS, rows, NOW)).toEqual([]);
  });

  it("連續失敗 ≥ 3 次 → failing；2 次不告警", () => {
    const failing = findHeartbeatProblems(JOBS, [row({ jobName: "hourly", lastSuccessAt: ago(0.5 * H), consecutiveFailures: 3, lastError: "boom" })], NOW);
    expect(failing).toEqual([{ kind: "failing", job: "hourly", consecutiveFailures: 3, lastError: "boom" }]);
    expect(findHeartbeatProblems(JOBS, [row({ jobName: "hourly", lastSuccessAt: ago(0.5 * H), consecutiveFailures: 2 })], NOW)).toEqual([]);
  });

  it("沒有狀態列（從沒跑過）、有列但從沒成功過且失敗不足 3 次：不告警", () => {
    expect(findHeartbeatProblems(JOBS, [], NOW)).toEqual([]);
    expect(findHeartbeatProblems(JOBS, [row({ jobName: "daily", consecutiveFailures: 1 })], NOW)).toEqual([]);
  });

  it("告警文字：含任務名、小時數；錯誤文字先清理 token 與 email", () => {
    const text = formatHeartbeatAlert([
      { kind: "overdue", job: "daily", lastSuccessAt: ago(49 * H), intervalMs: 24 * H, ageMs: 49 * H },
      { kind: "failing", job: "hourly", consecutiveFailures: 4, lastError: "Error: fetch https://x.test/?access_token=abc123 by me@example.com" },
    ]);
    expect(text).toContain("daily");
    expect(text).toContain("49");
    expect(text).toContain("連續失敗 4 次");
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("me@example.com");
  });
});

describe("checkHeartbeats（告警、去重、未設 webhook）", () => {
  const overdueRows = [row({ jobName: "hourly", lastSuccessAt: ago(5 * H) })];

  function deps(over: Parameters<typeof checkHeartbeats>[1] = {}) {
    const alert = vi.fn(async () => true);
    const markAlerted = vi.fn(async () => undefined);
    const log = vi.fn();
    return { alert, markAlerted, log, base: { now: () => NOW, listStates: async () => overdueRows, alert, markAlerted, log, webhookUrl: "https://hooks.example/x", ...over } };
  }

  it("逾期 → 打 webhook 並記錄已告警", async () => {
    const d = deps();
    const res = await checkHeartbeats(JOBS, d.base);
    expect(res.webhook).toBe("sent");
    expect(res.alerted).toEqual(["hourly"]);
    expect(d.alert).toHaveBeenCalledTimes(1);
    expect(d.alert.mock.calls[0]).toEqual(["https://hooks.example/x", expect.stringContaining("hourly")]);
    expect(d.markAlerted).toHaveBeenCalledWith(["hourly"], NOW);
  });

  it("去重：6 小時內已告警過 → 不再送；超過 6 小時 → 再送", async () => {
    const recent = deps({ listStates: async () => [row({ jobName: "hourly", lastSuccessAt: ago(5 * H), lastAlertedAt: ago(ALERT_DEDUPE_MS - 60_000) })] });
    expect((await checkHeartbeats(JOBS, recent.base)).webhook).toBe("nothing_to_report");
    expect(recent.alert).not.toHaveBeenCalled();

    const stale = deps({ listStates: async () => [row({ jobName: "hourly", lastSuccessAt: ago(5 * H), lastAlertedAt: ago(ALERT_DEDUPE_MS + 60_000) })] });
    expect((await checkHeartbeats(JOBS, stale.base)).webhook).toBe("sent");
  });

  it("未設 webhook：只 log，不寫已告警（設好之後下一輪才會送）", async () => {
    const d = deps({ webhookUrl: undefined });
    const res = await checkHeartbeats(JOBS, d.base);
    expect(res.webhook).toBe("not_configured");
    expect(d.alert).not.toHaveBeenCalled();
    expect(d.markAlerted).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("hourly"));
  });

  it("webhook 送失敗：不寫已告警，下一輪重試", async () => {
    const d = deps({ alert: vi.fn(async () => false) });
    const res = await checkHeartbeats(JOBS, d.base);
    expect(res.webhook).toBe("failed");
    expect(d.markAlerted).not.toHaveBeenCalled();
  });

  it("一切正常：不呼叫 webhook", async () => {
    const d = deps({ listStates: async () => [row({ jobName: "hourly", lastSuccessAt: ago(0.2 * H) })] });
    expect((await checkHeartbeats(JOBS, d.base)).webhook).toBe("nothing_to_report");
    expect(d.alert).not.toHaveBeenCalled();
  });
});

describe("scrubEvent（16 §錯誤監控：beforeSend 必清項目）", () => {
  it("/ical/u/{token} 路徑段", () => {
    expect(scrubString("GET /ical/u/AbC123xyzTOKEN.ics?x=1 failed")).toBe(`GET /ical/u/${FILTERED}?x=1 failed`.replace(`${FILTERED}?`, `${FILTERED}?`));
    expect(scrubString("https://sok.example/ical/u/secrettoken123/")).toBe(`https://sok.example/ical/u/${FILTERED}/`);
    const ev = scrubEvent({ request: { url: "https://sok.example/ical/u/tok_9f8e7d", path: "/ical/u/tok_9f8e7d" } });
    expect(JSON.stringify(ev)).not.toContain("tok_9f8e7d");
  });

  it("Authorization、Cookie、Set-Cookie 標頭（不分大小寫）", () => {
    const ev = scrubEvent({
      headers: { Authorization: "Basic dXNlcjpwYXNz", cookie: "sok_locale=ja; session=abcdef", "Set-Cookie": "a=b", "x-forwarded-for": "1.2.3.4", Accept: "text/html" },
    });
    expect(ev.headers.Authorization).toBe(FILTERED);
    expect(ev.headers.cookie).toBe(FILTERED);
    expect(ev.headers["Set-Cookie"]).toBe(FILTERED);
    expect(ev.headers.Accept).toBe("text/html");
  });

  it("自由文字中的 Bearer／Basic 憑證", () => {
    expect(scrubString("sent header Authorization: Bearer abcdefghijklmnop")).not.toContain("abcdefghijklmnop");
    expect(scrubString("Basic dXNlcjpwYXNzd29yZA==")).toBe(`Basic ${FILTERED}`);
  });

  it("OAuth token：欄位名稱與網址 query", () => {
    const ev = scrubEvent({ access_token: "ya29.aaa", refreshToken: "r-1", id_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk", client_secret: "cs", nested: { oauth: { token: "t" } } });
    expect(JSON.stringify(ev)).not.toMatch(/ya29|r-1|eyJhbGci|"cs"|"t"/);
    const url = scrubString("https://sok.example/cb?code=4%2F0AX&state=xyz&access_token=ya29.zzz&locale=ja");
    expect(url).toContain("locale=ja");
    expect(url).not.toMatch(/4%2F0AX|xyz|ya29/);
  });

  it("INTERNAL_API_SECRET 的值（環境變數與明確傳入）", () => {
    const secret = "internal-secret-0123456789-abcdefghijkl";
    vi.stubEnv("INTERNAL_API_SECRET", secret);
    try {
      expect(scrubString(`bot call failed with ${secret} in the body`)).toBe(`bot call failed with ${FILTERED} in the body`);
      expect(JSON.stringify(scrubEvent({ message: `x ${secret}`, extra: [secret] }))).not.toContain(secret);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(scrubString("use my-explicit-secret-value here", { secrets: ["my-explicit-secret-value"] })).toBe(`use ${FILTERED} here`);
  });

  it("email 位址", () => {
    expect(scrubString("failed for Someone.Name+tag@Example.co.uk and a@b.io")).toBe(`failed for ${FILTERED_EMAIL} and ${FILTERED_EMAIL}`);
    expect(JSON.stringify(scrubEvent({ user: { email: "me@example.com" }, note: "mail me@example.com" }))).not.toContain("me@example.com");
  });

  it("密碼欄位與連線字串裡的密碼", () => {
    const ev = scrubEvent({ password: "hunter2", user: { passwd: "x", Password_Confirm: "y" }, db: "postgres://sok:s3cr3tpw@postgres:5432/sok_studio" });
    expect(JSON.stringify(ev)).not.toMatch(/hunter2|s3cr3tpw|"x"|"y"/);
    expect(ev.db).toBe(`postgres://sok:${FILTERED}@postgres:5432/sok_studio`);
  });

  it("Error 物件（含 cause）轉成可序列化結構並清理；digest 保留；不修改輸入；循環參照不爆", () => {
    const cause = new Error("db down postgres://u:pw1234@h/db");
    const err = Object.assign(new Error("bad token=abc", { cause }), { digest: "SOK_QUERY_TIMEOUT" });
    const input = { err };
    const out = scrubEvent(input) as { err: { message: string; digest: string; cause: { message: string } } };
    expect(out.err.digest).toBe("SOK_QUERY_TIMEOUT");
    expect(out.err.cause.message).not.toContain("pw1234");
    expect(input.err).toBe(err);
    expect(err.message).toBe("bad token=abc");
    const loop: Record<string, unknown> = { a: 1 };
    loop.self = loop;
    expect(() => JSON.stringify(scrubEvent(loop))).not.toThrow();
  });

  it("無關資料原樣保留", () => {
    const ev = { path: "/en/calendar/2026-10", status: 500, tags: ["a", "b"], when: new Date("2026-10-15T00:00:00Z"), nothing: null };
    expect(scrubEvent(ev)).toEqual({ ...ev, when: "2026-10-15T00:00:00.000Z" });
  });
});

describe("結構化錯誤 log（module、job 標籤）", () => {
  it("帶 module／job；訊息與標頭已清理；查詢逾時記 warn", () => {
    const line = buildErrorLogLine(
      {
        error: Object.assign(new Error("boom for a@b.io"), { digest: "SOK_QUERY_TIMEOUT" }),
        module: "catalog",
        job: "sync_games",
        request: { path: "/ical/u/tok123456?x=1", method: "GET", headers: { authorization: "Bearer abcdefghij", host: "sok.example" } },
      },
      new Date("2026-10-15T00:00:00Z"),
    );
    expect(line).toMatchObject({ event: "error", level: "warn", module: "catalog", job: "sync_games", digest: "SOK_QUERY_TIMEOUT", ts: "2026-10-15T00:00:00.000Z" });
    const text = JSON.stringify(line);
    expect(text).not.toMatch(/a@b\.io|tok123456|abcdefghij/);
    expect(text).toContain("sok.example");
  });

  it("module 由 routePath 推出", () => {
    expect(moduleFromRoutePath("/[locale]/calendar/[month]")).toBe("catalog");
    expect(moduleFromRoutePath("/internal/reports")).toBe("admin");
    expect(moduleFromRoutePath("/healthz")).toBe("kernel");
    expect(moduleFromRoutePath(undefined)).toBe("kernel");
  });
});

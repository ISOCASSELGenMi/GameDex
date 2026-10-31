/**
 * /internal/settings：網站設定（12 §設定頁）。伺服器元件；內部使用，介面文字固定 zh-Hant。
 * 1. 評分來源顯示：可見來源、主分數優先序、Metascore／Userscore 顯示開關（環境變數是預設，這裡有值就覆蓋）
 * 2. 月曆預設顯示的遊戲類型與上市階段
 * 3. 模組啟停狀態（唯讀：需修改環境變數並重啟）＋ Metacritic「允許抓取」第二道開關
 * 4. 變更歷史（誰、何時、舊值→新值）
 * 每組各一個表單（POST /internal/settings，含 CSRF token）；「還原成預設」＝刪除該組的 DB 設定。
 */
import type { ReactElement } from "react";
import { AdminNav } from "@/kernel/ui/admin-nav";
import { createTranslator } from "@sok/i18n";
import { GAME_TYPES, KNOWN_RATING_PROVIDERS, RELEASE_STAGES } from "@/modules/catalog";
import { createCsrfToken } from "../csrf";
import { loadSettingsHistory, loadSettingsView, type SettingsGroup, type SettingsView } from "../use-cases/settings";

const t = createTranslator("zh-Hant");

export interface ModuleStatusRow {
  name: string;
  kind: "core" | "optional";
  enabled: boolean;
  requires: readonly string[];
}

export interface SettingsAdminPageProps {
  searchParams: Record<string, string | string[] | undefined>;
  modules: readonly ModuleStatusRow[];
}

const SOURCE_NAME: Record<string, string> = { igdb: "IGDB", metacritic_scrape: "Metacritic（抓取）" };
const sourceName = (id: string) => SOURCE_NAME[id] ?? id;
const gameTypeLabel = (id: string) => (t.has(`enums.gameType.${id}`) ? t.t(`enums.gameType.${id}`) : id);
const stageLabel = (id: string) => (t.has(`enums.releaseStage.${id}`) ? t.t(`enums.releaseStage.${id}`) : id);
const KEY_LABEL: Record<string, string> = {
  "ratings.visibleProviders": "可見的評分來源",
  "ratings.priority": "主分數優先序",
  "ratings.showMetascore": "顯示 Metascore",
  "ratings.showUserscore": "顯示 Userscore",
  "calendar.defaultGameTypes": "月曆預設遊戲類型",
  "calendar.defaultStages": "月曆預設上市階段",
  "metacritic.scrapeAllowed": "允許 Metacritic 抓取",
};
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const when = (d: Date) => `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;

export function formatSettingValue(key: string, v: unknown): string {
  if (v === null || v === undefined) return "（預設）";
  if (typeof v === "boolean") return v ? "開" : "關";
  if (Array.isArray(v)) {
    if (v.length === 0) return key === "ratings.visibleProviders" ? "（不過濾）" : "（空）";
    const f = key.startsWith("ratings.") ? sourceName : key === "calendar.defaultGameTypes" ? gameTypeLabel : key === "calendar.defaultStages" ? stageLabel : (x: string) => x;
    return v.map((x) => f(String(x))).join("、");
  }
  return JSON.stringify(v);
}

function Fieldset({ legend, children }: { legend: string; children: React.ReactNode }): ReactElement {
  return (
    <fieldset className="flex flex-col gap-1 rounded-md border border-[var(--border)] p-3">
      <legend className="px-1 font-semibold">{legend}</legend>
      {children}
    </fieldset>
  );
}

function Check({ name, value, label, checked }: { name: string; value?: string; label: string; checked: boolean }): ReactElement {
  return (
    <label className="inline-flex min-h-8 text-sm items-center gap-2">
      <input type="checkbox" name={name} {...(value !== undefined ? { value } : {})} defaultChecked={checked} className="size-5" />
      <span>{label}</span>
    </label>
  );
}

function GroupFooter({ group, csrf, hint }: { group: SettingsGroup; csrf: string; hint?: string }): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name="csrf" value={csrf} />
      <input type="hidden" name="group" value={group} />
      {hint ? <p className="text-sm text-[var(--muted)]">{hint}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="mode" value="save" className="btn-primary">
          儲存
        </button>
        <button type="submit" name="mode" value="reset" className="btn-secondary">
          還原成預設（環境變數）
        </button>
      </div>
    </div>
  );
}

const srcText = (s: "db" | "env") => (s === "db" ? "目前來源：後台設定" : "目前來源：環境變數／內建預設");

function RatingsForm({ v, csrf }: { v: SettingsView["ratings"]; csrf: string }): ReactElement {
  return (
    <form method="post" action="/internal/settings/save" aria-labelledby="set-ratings" className="flex flex-col gap-3" data-settings-group="ratings">
      <h2 id="set-ratings" className="text-xl font-semibold">
        評分來源顯示
      </h2>
      <p className="text-sm text-[var(--muted)]">取代僅靠環境變數 VISIBLE_SCORE_PROVIDERS／RATING_DISPLAY_PRIORITY 的做法；環境變數仍是預設值。詳情頁快取到期後生效。</p>
      <Fieldset legend="可見的來源（全部不勾＝不過濾）">
        {KNOWN_RATING_PROVIDERS.map((id) => (
          <Check key={id} name="visible" value={id} label={sourceName(id)} checked={v.visible.includes(id)} />
        ))}
        <p className="text-sm text-[var(--muted)]">{srcText(v.visibleSource)}</p>
      </Fieldset>
      <Fieldset legend="主分數優先序（前面的優先）">
        {[0, 1].map((i) => (
          <label key={i} className="flex flex-wrap items-center gap-2">
            <span>第 {i + 1} 順位</span>
            <select
              name={`priority_${i + 1}`}
              defaultValue={v.priority[i] ?? ""}
              className="min-h-8 text-sm rounded-md border border-[var(--border)] bg-[var(--background)] px-2"
            >
              <option value="">（不指定）</option>
              {KNOWN_RATING_PROVIDERS.map((id) => (
                <option key={id} value={id}>
                  {sourceName(id)}
                </option>
              ))}
            </select>
          </label>
        ))}
        <p className="text-sm text-[var(--muted)]">{srcText(v.prioritySource)}</p>
      </Fieldset>
      <Fieldset legend="Metacritic 分數類型">
        <Check name="show_metascore" label="顯示 Metascore（媒體評分）" checked={v.showMetascore} />
        <Check name="show_userscore" label="顯示 Userscore（玩家評分）" checked={v.showUserscore} />
        <p className="text-sm text-[var(--muted)]">關閉後，詳情頁的分數區與評分排名頁的對應欄位都會隱藏。</p>
      </Fieldset>
      <GroupFooter group="ratings" csrf={csrf} />
    </form>
  );
}

function CalendarForm({ v, csrf }: { v: SettingsView["calendar"]; csrf: string }): ReactElement {
  return (
    <form method="post" action="/internal/settings/save" aria-labelledby="set-calendar" className="flex flex-col gap-3" data-settings-group="calendar">
      <h2 id="set-calendar" className="text-xl font-semibold">
        月曆預設顯示
      </h2>
      <p className="text-sm text-[var(--muted)]">月曆、時間軸、瀏覽、公司／系列頁在使用者沒有自己篩選時的預設（環境變數 CALENDAR_VISIBLE_GAME_TYPES／CALENDAR_VISIBLE_RELEASE_STAGES 是預設值）。</p>
      <Fieldset legend="遊戲類型">
        <div className="flex flex-wrap gap-x-4">
          {GAME_TYPES.map((id) => (
            <Check key={id} name="game_types" value={id} label={gameTypeLabel(id)} checked={v.gameTypes.includes(id)} />
          ))}
        </div>
        <p className="text-sm text-[var(--muted)]">{srcText(v.gameTypesSource)}</p>
      </Fieldset>
      <Fieldset legend="上市階段">
        <div className="flex flex-wrap gap-x-4">
          {RELEASE_STAGES.map((id) => (
            <Check key={id} name="stages" value={id} label={stageLabel(id)} checked={v.stages.includes(id)} />
          ))}
        </div>
        <p className="text-sm text-[var(--muted)]">{srcText(v.stagesSource)}</p>
      </Fieldset>
      <GroupFooter group="calendar" csrf={csrf} hint="兩者都至少要選一個。" />
    </form>
  );
}

function ModulesSection({ modules, mc, csrf }: { modules: readonly ModuleStatusRow[]; mc: SettingsView["metacritic"]; csrf: string }): ReactElement {
  return (
    <section aria-labelledby="set-modules" className="flex flex-col gap-3" data-settings-group="modules">
      <h2 id="set-modules" className="text-xl font-semibold">
        模組啟停狀態
      </h2>
      <p className="notice">唯讀。啟用的模組由環境變數 MODULES 決定，需修改環境變數並重啟才會生效（模組啟停不做成執行期切換：它牽動排程註冊、路由與資料表）。</p>
      <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="模組列表">
        <table className="release-table">
          <thead>
            <tr>
              <th scope="col">模組</th>
              <th scope="col">類型</th>
              <th scope="col">狀態</th>
              <th scope="col">依賴</th>
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <tr key={m.name} data-module={m.name} data-enabled={m.enabled ? "true" : "false"}>
                <th scope="row">{m.name}</th>
                <td>{m.kind === "core" ? "核心" : "可選"}</td>
                <td>{m.enabled ? "啟用" : "停用"}</td>
                <td>{m.requires.length > 0 ? m.requires.join("、") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form method="post" action="/internal/settings/save" aria-labelledby="set-mc" className="flex flex-col gap-2" data-settings-group="metacritic">
        <h3 id="set-mc" className="text-lg font-semibold">
          Metacritic 抓取（兩道開關）
        </h3>
        <p>
          環境變數 METACRITIC_SCRAPE_ENABLED：<strong data-mc-env={mc.envEnabled ? "on" : "off"}>{mc.envEnabled ? "開" : "關（預設）"}</strong>（需修改環境變數並重啟）
        </p>
        <Check name="scrape_allowed" label="後台允許抓取（第二道開關）" checked={mc.scrapeAllowed} />
        <p data-mc-effective={mc.effective ? "on" : "off"}>
          目前實際狀態：<strong>{mc.effective ? "會抓取" : "不抓取"}</strong>。環境變數與這個開關<strong>兩者皆開</strong>才會對 metacritic.com 發出請求；任一關閉則請求數為 0。
        </p>
        <GroupFooter group="metacritic" csrf={csrf} />
      </form>
    </section>
  );
}

export async function SettingsAdminPage({ searchParams, modules }: SettingsAdminPageProps): Promise<ReactElement> {
  const view = await loadSettingsView();
  const history = await loadSettingsHistory(50);
  const csrf = createCsrfToken(process.env.ADMIN_BASIC_AUTH_PASS ?? "");
  const saved = one(searchParams.saved);
  const error = one(searchParams.error);
  const flash = saved
    ? `${one(searchParams.mode) === "reset" ? "已還原成預設" : "已儲存"}（${saved}，${one(searchParams.changed) ?? "0"} 項有變動）`
    : null;
  return (
    <main id="main" className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6">
      <h1 className="text-2xl font-bold">網站設定</h1>
      <AdminNav current="settings" />
      {flash ? (
        <p role="status" className="notice" data-flash="saved">
          {flash}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="notice" data-flash="error">
          {error}
        </p>
      ) : null}
      <RatingsForm v={view.ratings} csrf={csrf} />
      <CalendarForm v={view.calendar} csrf={csrf} />
      <ModulesSection modules={modules} mc={view.metacritic} csrf={csrf} />
      <section aria-labelledby="set-history" className="flex flex-col gap-2">
        <h2 id="set-history" className="text-xl font-semibold">
          變更歷史
        </h2>
        {history.length === 0 ? (
          <p>尚無變更。</p>
        ) : (
          <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="設定變更歷史">
            <table className="release-table" data-settings-history="">
              <thead>
                <tr>
                  <th scope="col">時間</th>
                  <th scope="col">操作者</th>
                  <th scope="col">設定</th>
                  <th scope="col">舊值</th>
                  <th scope="col">新值</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{when(h.changedAt)}</td>
                    <td>{h.changedBy}</td>
                    <th scope="row">{KEY_LABEL[h.key] ?? h.key}</th>
                    <td>{formatSettingValue(h.key, h.oldValue)}</td>
                    <td>{formatSettingValue(h.key, h.newValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

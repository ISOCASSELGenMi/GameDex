/**
 * /internal/settings 的 Use Case（12 §設定頁）：把表單驗證成設定變更、讀出目前生效的值與來源。
 * 設定的儲存與稽核在 kernel（kernel/settings）；清單裡的值合不合法（評分來源、遊戲類型、上市階段）由這裡檢查。
 */
import { getCoreEnv } from "@/kernel/config/env";
import {
  getSettings,
  listSettingAudit,
  updateSettings,
  type AppliedSettingChange,
  type SettingAuditRow,
  type SettingChange,
  type SettingKey,
} from "@/kernel/settings";
import {
  DEFAULT_RATING_DISPLAY_CONFIG,
  GAME_TYPES,
  KNOWN_RATING_PROVIDERS,
  RELEASE_STAGES,
  releaseFilterDefaults,
  resolveRatingDisplayConfig,
} from "@/modules/catalog";

export const SETTINGS_GROUPS = ["ratings", "calendar", "metacritic"] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

export const GROUP_KEYS: Readonly<Record<SettingsGroup, readonly SettingKey[]>> = {
  ratings: ["ratings.visibleProviders", "ratings.priority", "ratings.showMetascore", "ratings.showUserscore"],
  calendar: ["calendar.defaultGameTypes", "calendar.defaultStages"],
  metacritic: ["metacritic.scrapeAllowed"],
};

export type ParsedSettings = { ok: true; changes: SettingChange[] } | { ok: false; error: string };

const values = (form: FormData, name: string): string[] =>
  form.getAll(name).filter((v): v is string => typeof v === "string" && v !== "");

function onlyKnown(list: readonly string[], allowed: readonly string[], label: string): string | null {
  const bad = list.filter((x) => !allowed.includes(x));
  return bad.length > 0 ? `${label}含未知的值：${bad.slice(0, 3).join(", ")}` : null;
}

/** 表單 → 變更。mode=reset 時整組還原成預設（刪除該組所有設定列）。 */
export function parseSettingsForm(group: SettingsGroup, mode: "save" | "reset", form: FormData): ParsedSettings {
  if (mode === "reset") return { ok: true, changes: GROUP_KEYS[group].map((key) => ({ key, value: null })) };
  if (group === "ratings") {
    const visible = [...new Set(values(form, "visible"))];
    const priority = [...new Set([values(form, "priority_1")[0], values(form, "priority_2")[0]].filter((x): x is string => !!x))];
    const err = onlyKnown(visible, KNOWN_RATING_PROVIDERS, "可見來源") ?? onlyKnown(priority, KNOWN_RATING_PROVIDERS, "主分數優先序");
    if (err) return { ok: false, error: err };
    if (priority.length === 0) return { ok: false, error: "主分數優先序至少要選一個來源" };
    return {
      ok: true,
      changes: [
        { key: "ratings.visibleProviders", value: visible },
        { key: "ratings.priority", value: priority },
        { key: "ratings.showMetascore", value: form.get("show_metascore") === "on" },
        { key: "ratings.showUserscore", value: form.get("show_userscore") === "on" },
      ],
    };
  }
  if (group === "calendar") {
    const types = [...new Set(values(form, "game_types"))];
    const stages = [...new Set(values(form, "stages"))];
    const err = onlyKnown(types, GAME_TYPES, "遊戲類型") ?? onlyKnown(stages, RELEASE_STAGES, "上市階段");
    if (err) return { ok: false, error: err };
    if (types.length === 0 || stages.length === 0) return { ok: false, error: "遊戲類型與上市階段都至少要選一個" };
    return {
      ok: true,
      changes: [
        { key: "calendar.defaultGameTypes", value: types },
        { key: "calendar.defaultStages", value: stages },
      ],
    };
  }
  return { ok: true, changes: [{ key: "metacritic.scrapeAllowed", value: form.get("scrape_allowed") === "on" }] };
}

export type SaveSettingsResult = { ok: true; applied: AppliedSettingChange[] } | { ok: false; error: string };

export async function saveSettings(group: SettingsGroup, mode: "save" | "reset", form: FormData, actor: string): Promise<SaveSettingsResult> {
  const parsed = parseSettingsForm(group, mode, form);
  if (!parsed.ok) return parsed;
  const applied = await updateSettings(parsed.changes, actor);
  return { ok: true, applied };
}

export type ValueSource = "db" | "env";

export interface SettingsView {
  ratings: {
    visible: string[];
    visibleSource: ValueSource;
    priority: string[];
    prioritySource: ValueSource;
    showMetascore: boolean;
    showUserscore: boolean;
    /** 環境變數層的預設（還原後的樣子）。 */
    envDefault: { visible: string[]; priority: string[] };
  };
  calendar: { gameTypes: string[]; gameTypesSource: ValueSource; stages: string[]; stagesSource: ValueSource; envDefault: { gameTypes: string[]; stages: string[] } };
  metacritic: { envEnabled: boolean; scrapeAllowed: boolean; effective: boolean };
}

const asList = (v: unknown): string[] | undefined => (Array.isArray(v) ? (v as string[]) : undefined);

export async function loadSettingsView(env = getCoreEnv()): Promise<SettingsView> {
  const s = await getSettings();
  let base = DEFAULT_RATING_DISPLAY_CONFIG;
  try {
    base = resolveRatingDisplayConfig(env);
  } catch {
    /* 環境變數有誤時啟動就會失敗；這裡退回內建預設只為了讓設定頁開得起來 */
  }
  const calEnv = releaseFilterDefaults();
  const visible = asList(s.get("ratings.visibleProviders"));
  const priority = asList(s.get("ratings.priority"));
  const types = asList(s.get("calendar.defaultGameTypes"));
  const stages = asList(s.get("calendar.defaultStages"));
  const allowed = s.get("metacritic.scrapeAllowed") === true;
  return {
    ratings: {
      visible: visible ?? [...base.visible],
      visibleSource: visible ? "db" : "env",
      priority: priority && priority.length > 0 ? priority : [...base.priority],
      prioritySource: priority ? "db" : "env",
      showMetascore: s.get("ratings.showMetascore") !== false,
      showUserscore: s.get("ratings.showUserscore") !== false,
      envDefault: { visible: [...base.visible], priority: [...base.priority] },
    },
    calendar: {
      gameTypes: types && types.length > 0 ? types : [...calEnv.gameTypes],
      gameTypesSource: types ? "db" : "env",
      stages: stages && stages.length > 0 ? stages : [...calEnv.stages],
      stagesSource: stages ? "db" : "env",
      envDefault: { gameTypes: [...calEnv.gameTypes], stages: [...calEnv.stages] },
    },
    metacritic: { envEnabled: env.METACRITIC_SCRAPE_ENABLED, scrapeAllowed: allowed, effective: env.METACRITIC_SCRAPE_ENABLED && allowed },
  };
}

export type { SettingAuditRow };
export async function loadSettingsHistory(limit = 50): Promise<SettingAuditRow[]> {
  return listSettingAudit(limit);
}

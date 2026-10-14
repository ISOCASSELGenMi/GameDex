/**
 * npm -w apps/web run i18n:check（CI，spec 16）。
 * 從磁碟讀 messages/{locale}/{namespace}.json（不經 messages.ts），所以漏註冊或多出的檔案也看得到。
 * 核心命名空間不一致 → 退出碼 1；genres／themes 缺翻譯只印報告。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkMessages, type NamespaceInput } from "../src/check";
import { AVAILABLE_LOCALES } from "../src/locales";
import { CORE_NAMESPACES, LABEL_NAMESPACES, NAMESPACES, type Messages } from "../src/messages";

const messagesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../messages");

function load(locale: string, namespace: string): Messages | undefined {
  const file = path.join(messagesDir, locale, `${namespace}.json`);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as Messages;
}

function inputs(namespaces: readonly string[]): NamespaceInput[] {
  return namespaces.map((namespace) => ({
    namespace,
    byLocale: Object.fromEntries(AVAILABLE_LOCALES.map((l) => [l, load(l, namespace)])),
  }));
}

const { errors, warnings } = checkMessages(AVAILABLE_LOCALES, inputs(CORE_NAMESPACES), inputs(LABEL_NAMESPACES));

// 磁碟上有、但沒註冊的語系資料夾或命名空間檔案
for (const dir of readdirSync(messagesDir, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  if (!(AVAILABLE_LOCALES as readonly string[]).includes(dir.name)) {
    warnings.push(`messages/${dir.name}：不在 AVAILABLE_LOCALES，未啟用`);
    continue;
  }
  for (const f of readdirSync(path.join(messagesDir, dir.name))) {
    const ns = f.replace(/\.json$/, "");
    if (f.endsWith(".json") && !(NAMESPACES as readonly string[]).includes(ns)) {
      errors.push(`messages/${dir.name}/${f}：未在 messages.ts 註冊的命名空間`);
    }
  }
}

for (const w of warnings) console.log(`⚠ ${w}`);
for (const e of errors) console.error(`✗ ${e}`);
if (errors.length > 0) {
  console.error(`i18n:check 失敗：${errors.length} 個錯誤`);
  process.exit(1);
}
console.log(`i18n:check 通過（語系 ${AVAILABLE_LOCALES.join(", ")}；核心命名空間 ${CORE_NAMESPACES.join(", ")}；警告 ${warnings.length}）`);

/**
 * npm run i18n:report [-- --out <檔案>] [-- --strict]
 * 翻譯缺漏報告：各語系各命名空間缺／多餘的 key，與「值和 en 逐字相同、可能未翻譯」的清單。
 * 預設只印 stdout、退出碼 0；--out 另存檔（例如 .local/i18n-report.txt）；--strict 有缺／多餘 key 時退出碼 1。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AVAILABLE_LOCALES } from "../src/locales";
import { CORE_NAMESPACES, FALLBACK_LOCALE, LABEL_NAMESPACES, type Messages } from "../src/messages";
import { buildReport, formatReport, isIncomplete, type ReportNamespaceInput } from "../src/report";

const messagesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../messages");

function load(locale: string, namespace: string): Messages | undefined {
  const file = path.join(messagesDir, locale, `${namespace}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Messages) : undefined;
}

function input(namespace: string, kind: "core" | "label"): ReportNamespaceInput {
  return { namespace, kind, byLocale: Object.fromEntries(AVAILABLE_LOCALES.map((l) => [l, load(l, namespace)])) };
}

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const rows = buildReport(
  AVAILABLE_LOCALES,
  [...CORE_NAMESPACES.map((n) => input(n, "core")), ...LABEL_NAMESPACES.map((n) => input(n, "label"))],
  FALLBACK_LOCALE,
);
const text = `i18n 缺漏報告（語系 ${AVAILABLE_LOCALES.join(", ")}；fallback ${FALLBACK_LOCALE}）\n${formatReport(rows)}\n`;
console.log(text);
if (outIdx >= 0 && args[outIdx + 1]) {
  const out = path.resolve(args[outIdx + 1]!);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, text, "utf8");
  console.log(`已寫入 ${out}`);
}
if (args.includes("--strict") && isIncomplete(rows)) {
  console.error("i18n:report --strict：字典不完整");
  process.exit(1);
}

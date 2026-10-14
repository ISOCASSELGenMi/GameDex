/**
 * UI 文字的小工具：翻譯器快取、enum／分類標籤。只用 @sok/i18n 的字典，不另寫對照表。
 */
import { createTranslator, translateLabel, type Locale, type Translator } from "@sok/i18n";

const cache = new Map<Locale, Translator>();

export function getTranslator(locale: Locale): Translator {
  let t = cache.get(locale);
  if (!t) {
    t = createTranslator(locale);
    cache.set(locale, t);
  }
  return t;
}

export function stageLabel(t: Translator, stage: string): string {
  return t.t(`enums.releaseStage.${stage}`);
}

export function statusLabel(t: Translator, status: string): string {
  return t.t(`enums.releaseStatus.${status}`);
}

export function platformKindLabel(t: Translator, kind: string): string {
  return t.t(`enums.platformKind.${kind}`);
}

export function regionLabel(t: Translator, code: string): string {
  const key = `enums.region.${code}`;
  return t.has(key) ? t.t(key) : code;
}

export function genreLabel(t: Translator, slug: string, fallbackName?: string | null): string {
  return translateLabel(t, "genres", slug, fallbackName);
}

export function eventKindLabel(t: Translator, kind: string): string {
  return t.t(`enums.eventKind.${kind}`);
}

/**
 * Nếp Mail localisation core.
 *
 * Keys are the Vietnamese source strings used by the interface, so an
 * untranslated string degrades to readable Vietnamese instead of a raw key.
 * ASCII keys are used for strings that never appear in Vietnamese source
 * (e-mail chrome, public unsubscribe page).
 */
export const LOCALES = [
  { code: "vi", native: "Tiếng Việt", english: "Vietnamese", tag: "vi-VN" },
  { code: "en", native: "English", english: "English", tag: "en-US" },
  { code: "es", native: "Español", english: "Spanish", tag: "es-ES" },
  {
    code: "pt",
    native: "Português (Brasil)",
    english: "Portuguese (Brazil)",
    tag: "pt-BR",
  },
  { code: "fr", native: "Français", english: "French", tag: "fr-FR" },
  { code: "de", native: "Deutsch", english: "German", tag: "de-DE" },
  { code: "ru", native: "Русский", english: "Russian", tag: "ru-RU" },
  { code: "ja", native: "日本語", english: "Japanese", tag: "ja-JP" },
  { code: "ko", native: "한국어", english: "Korean", tag: "ko-KR" },
  {
    code: "zh",
    native: "简体中文",
    english: "Chinese (Simplified)",
    tag: "zh-CN",
  },
] as const;

export type LocaleCode = (typeof LOCALES)[number]["code"];
export type Vars = Record<string, string | number>;
export type Pack = Record<string, string>;

export const DEFAULT_LOCALE: LocaleCode = "vi";
export const LOCALE_CODES = LOCALES.map((l) => l.code) as LocaleCode[];

export function isLocale(value: unknown): value is LocaleCode {
  return (
    typeof value === "string" && LOCALE_CODES.includes(value as LocaleCode)
  );
}

export function localeInfo(code: LocaleCode) {
  return LOCALES.find((l) => l.code === code) || LOCALES[0];
}

export function localeTag(code: LocaleCode): string {
  return localeInfo(code).tag;
}

/** Map an Accept-Language header (or navigator.languages) to a supported code. */
export function bestLocale(input?: string | null): LocaleCode {
  if (!input) return DEFAULT_LOCALE;
  const wanted = input
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q) : 1 };
    })
    .filter((v) => v.tag)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of wanted) {
    if (tag === "*") break;
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
    // Chinese variants: zh-TW/HK still read Simplified better than English here.
    if (base === "zh") return "zh";
    if (base === "pt") return "pt";
  }
  return DEFAULT_LOCALE;
}

export function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/**
 * Resolve a key for a locale: exact key, then the `|one` plural variant,
 * then English, then the key itself (readable Vietnamese source).
 */
export function translate(
  locale: LocaleCode,
  key: string,
  vars?: Vars,
): string {
  const pack = PACKS[locale] || {};
  let text: string | undefined;
  if (vars && "n" in vars && Number(vars.n) === 1) text = pack[`${key}|one`];
  if (text === undefined) text = pack[key];
  // Vietnamese is the source language: its fallback is the key itself.
  if (text === undefined && locale !== "vi" && locale !== "en")
    text = PACKS.en[key];
  if (text === undefined) text = key;
  return interpolate(text, vars);
}

/** Which locales carry an explicit translation for a key (used by tests/docs). */
export function coverage(key: string): LocaleCode[] {
  return LOCALE_CODES.filter(
    (code) =>
      PACKS[code][key] !== undefined || PACKS[code][`${key}|one`] !== undefined,
  );
}

import { vi } from "./locales/vi.ts";
import { en } from "./locales/en.ts";
import { es } from "./locales/es.ts";
import { pt } from "./locales/pt.ts";
import { fr } from "./locales/fr.ts";
import { de } from "./locales/de.ts";
import { ru } from "./locales/ru.ts";
import { ja } from "./locales/ja.ts";
import { ko } from "./locales/ko.ts";
import { zh } from "./locales/zh.ts";

const PACKS: Record<LocaleCode, Pack> = {
  vi,
  en,
  es,
  pt,
  fr,
  de,
  ru,
  ja,
  ko,
  zh,
};

export { PACKS };

/** Every translated key across every pack — documentation and QA helper. */
export function allKeys(): string[] {
  const keys = new Set<string>();
  for (const code of LOCALE_CODES)
    for (const key of Object.keys(PACKS[code]))
      keys.add(key.replace(/\|one$/, ""));
  return [...keys].sort();
}

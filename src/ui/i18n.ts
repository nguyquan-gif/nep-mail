import { useSyncExternalStore } from "react";
import {
  bestLocale,
  isLocale,
  localeTag,
  translate,
  type LocaleCode,
  type Vars,
} from "../core/i18n.ts";

export { LOCALES, localeInfo, type LocaleCode } from "../core/i18n.ts";

const STORAGE = "nep-mail-locale";

function stored(): LocaleCode | null {
  try {
    const value = localStorage.getItem(STORAGE);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function initialLocale(): LocaleCode {
  if (typeof window === "undefined") return "vi";
  const saved = stored();
  if (saved) return saved;
  const languages =
    (navigator.languages && navigator.languages.join(",")) ||
    navigator.language;
  return bestLocale(languages);
}

let current: LocaleCode = initialLocale();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Translate a key for the active interface language. */
export function t(key: string, vars?: Vars): string {
  return translate(current, key, vars);
}

export function currentLocale(): LocaleCode {
  return current;
}

export function setLocale(next: LocaleCode) {
  if (!isLocale(next) || next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE, next);
  } catch {
    /* private mode: language still applies for this page view */
  }
  applyDocumentLang();
  listeners.forEach((listener) => listener());
}

export function applyDocumentLang() {
  if (typeof document !== "undefined")
    document.documentElement.lang = localeTag(current);
}

/** Re-render on language change; returns the active locale and a setter. */
export function useLocale() {
  const locale = useSyncExternalStore(
    subscribe,
    currentLocale,
    () => "vi" as LocaleCode,
  );
  return [locale, setLocale] as const;
}

export function formatDate(value: string, withTime = true): string {
  try {
    return new Date(value).toLocaleString(localeTag(current), {
      dateStyle: "short",
      ...(withTime ? { timeStyle: "short" as const } : {}),
    });
  } catch {
    return value;
  }
}

export function formatNumber(value: number): string {
  return value.toLocaleString(localeTag(current));
}

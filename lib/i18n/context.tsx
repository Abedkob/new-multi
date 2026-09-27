"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { en, type DictionaryKey } from "./dictionaries/en";
import { ar } from "./dictionaries/ar";
import { MSG_SEP, type Locale } from "./types";

const DICTIONARIES = { en, ar } as const;

type Ctx = {
  locale: Locale;
  t: (key: DictionaryKey) => string;
  setLocale: (locale: Locale) => void;
};

const LocaleContext = createContext<Ctx | null>(null);

/**
 * Mounted once in app/admin/layout.tsx, seeded with the server-resolved locale so there is never
 * a hydration mismatch or a flash of the wrong language.
 */
export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const value = useMemo<Ctx>(
    () => ({
      locale,
      t: (key) => DICTIONARIES[locale][key],
      setLocale,
    }),
    [locale],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

// Falls back to English rather than throwing: components shared with /login and /platform (which
// mount no <LocaleProvider>) can call useT()/useLocale() directly and render unchanged there,
// while picking up the owner's chosen language automatically inside /admin.
const FALLBACK: Ctx = { locale: "en", t: (key) => en[key], setLocale: () => {} };

function useLocaleContext() {
  return useContext(LocaleContext) ?? FALLBACK;
}

export function useT() {
  return useLocaleContext().t;
}

export function useLocale() {
  const { locale, setLocale } = useLocaleContext();
  return { locale, setLocale };
}

/** Resolves a plain key or an encodeMessage()-built raw string, filling in {0}, {1}... */
export function resolveMessage(t: (key: DictionaryKey) => string, raw: string): string {
  const [key, ...params] = raw.split(MSG_SEP);
  return params.reduce((s, p, i) => s.replaceAll(`{${i}}`, p), t(key as DictionaryKey));
}

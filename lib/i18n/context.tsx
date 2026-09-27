"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { en, type DictionaryKey } from "./dictionaries/en";
import { ar } from "./dictionaries/ar";
import type { Locale } from "./types";

// Re-exported so existing client-file imports (`from "@/lib/i18n/context"`) keep working
// unchanged. Server Components must import it from "@/lib/i18n/types" instead — this module is
// "use client", so a Server Component may only pass its exports as props/JSX, never call them
// directly (that's the "Attempted to call resolveMessage() from the server" runtime error).
export { resolveMessage } from "./types";

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

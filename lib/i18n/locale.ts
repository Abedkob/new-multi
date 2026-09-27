import { cookies } from "next/headers";
import { en, type DictionaryKey } from "./dictionaries/en";
import { ar } from "./dictionaries/ar";
import { LOCALES, type Locale } from "./types";

export const ADMIN_LOCALE_COOKIE = "admin_locale";

const DICTIONARIES = { en, ar } as const;

/** Server Components/Actions: reads the owner's chosen admin dashboard language. Defaults "en". */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const raw = store.get(ADMIN_LOCALE_COOKIE)?.value;
  return (LOCALES as readonly string[]).includes(raw ?? "") ? (raw as Locale) : "en";
}

export async function getDictionary() {
  const locale = await getLocale();
  return DICTIONARIES[locale];
}

/** For Server Components/Actions: `const t = await getT();` then `t("nav.home")`. */
export async function getT() {
  const dict = await getDictionary();
  return (key: DictionaryKey) => dict[key];
}

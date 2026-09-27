"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requireOwner } from "@/lib/session";
import { ADMIN_LOCALE_COOKIE } from "@/lib/i18n/locale";
import { LOCALES, type Locale } from "@/lib/i18n/types";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * allowMustChange: true so a fresh owner forced to /admin/change-password can still switch to
 * Arabic on that very page — otherwise the switcher would be unreachable on first login.
 */
export async function setAdminLocaleAction(locale: Locale) {
  await requireOwner({ allowMustChange: true });
  if (!(LOCALES as readonly string[]).includes(locale)) return;

  const store = await cookies();
  store.set(ADMIN_LOCALE_COOKIE, locale, {
    path: "/admin",
    maxAge: ONE_YEAR_SECONDS,
    httpOnly: true,
    sameSite: "lax",
  });
  revalidatePath("/admin", "layout");
}

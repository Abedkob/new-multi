"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { savePreferredAdminLocale } from "@/lib/data/users";
import { requireTenantMember } from "@/lib/session";
import { ADMIN_LOCALE_COOKIE } from "@/lib/i18n/locale";
import { LOCALES, type Locale } from "@/lib/i18n/types";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * allowMustChange: true so a fresh owner forced to /admin/change-password can still switch to
 * Arabic on that very page — otherwise the switcher would be unreachable on first login.
 */
export async function setAdminLocaleAction(locale: Locale) {
  const owner = await requireTenantMember({ allowMustChange: true });
  if (!(LOCALES as readonly string[]).includes(locale)) return;

  const store = await cookies();
  store.set(ADMIN_LOCALE_COOKIE, locale, {
    path: "/admin",
    maxAge: ONE_YEAR_SECONDS,
    httpOnly: true,
    sameSite: "lax",
  });

  // And persisted (D58). The cookie is what every request reads; this column is what a
  // SCHEDULED job reads at 09:00 on a Monday, when there is no request and therefore no cookie.
  // Without it a merchant who uses the dashboard in Arabic would get their weekly summary in
  // English — a notification in the wrong language is one a person stops reading.
  //
  // Best-effort: the language switch must not fail because a write failed. The cookie has
  // already been set, which is what this click was about.
  await savePreferredAdminLocale(owner.userId, locale).catch((error) => {
    console.error(
      "[locale] could not persist the admin language:",
      error instanceof Error ? error.message : error,
    );
  });

  revalidatePath("/admin", "layout");
}

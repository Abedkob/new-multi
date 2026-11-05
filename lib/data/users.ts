import { prisma } from "@/lib/prisma";

/** Also bumps sessionVersion, so every other session of this user is revoked (lib/session.ts). */
export function setPassword(userId: string, passwordHash: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false, sessionVersion: { increment: 1 } },
    select: { id: true },
  });
}

/**
 * The admin dashboard language this user chose, persisted (D58).
 *
 * The cookie set beside this is what every request reads. This column exists for the one reader
 * that has no request: the scheduled job that writes a weekly summary at 09:00 on Monday. A
 * merchant who uses the dashboard in Arabic and receives their summary in English has been told
 * something true in a language they did not ask for, and will stop reading it.
 *
 * Not under RLS, like the rest of `User` — it is keyed by the person, not by a store.
 */
export function savePreferredAdminLocale(userId: string, locale: "en" | "ar") {
  return prisma.user.update({ where: { id: userId }, data: { adminLocale: locale } });
}

/** The language to write to this person in, with no request to ask (D58). */
export async function preferredAdminLocale(userId: string): Promise<"en" | "ar" | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { adminLocale: true },
  });
  return user?.adminLocale === "ar" || user?.adminLocale === "en" ? user.adminLocale : null;
}

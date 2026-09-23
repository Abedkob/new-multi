import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// cache() dedupes within one render pass only (not across requests), so a page that calls
// requireOwner() itself as well as its layout costs one query, not two.
const loadSessionUser = cache((userId: string) =>
  prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      role: true,
      mustChangePassword: true,
      sessionVersion: true,
      tenant: { select: { id: true } },
    },
  }),
);

/**
 * Server-side role checks, repeated inside pages and actions in addition to
 * proxy.ts. tenantId comes from the session, never from request input.
 */
export async function requireOwner(opts?: { allowMustChange?: boolean }) {
  const session = await auth();
  const sessionUser = session?.user;
  if (!sessionUser || sessionUser.role !== "STORE_OWNER") redirect("/login");

  // Re-read from the DB instead of trusting the JWT: mustChangePassword, whether the account
  // still owns a tenant at all, and whether this session was revoked can all change after the
  // session was issued (the platform admin resets the owner's password, or deletes their
  // store) and must take effect on the very next request, not just on next login.
  const user = await loadSessionUser(sessionUser.id);
  if (
    !user ||
    !user.tenant ||
    user.role !== "STORE_OWNER" ||
    // An admin password reset bumps sessionVersion: every session issued before it — including
    // one an attacker holds — is dead, rather than being sent to /admin/change-password where
    // it could set a password of its own.
    user.sessionVersion !== (sessionUser.sessionVersion ?? 0)
  ) {
    // Not just redirect("/login"): the JWT cookie is still valid and still says
    // role: STORE_OWNER, so proxy.ts (which only reads the JWT) would bounce them straight
    // back to /admin, looping forever. /force-logout clears the cookie first.
    redirect("/force-logout");
  }
  if (user.mustChangePassword && !opts?.allowMustChange) {
    redirect("/admin/change-password");
  }
  return {
    userId: sessionUser.id,
    tenantId: user.tenant.id,
    name: user.name,
    email: user.email,
  };
}

export async function requirePlatformAdmin() {
  const session = await auth();
  const sessionUser = session?.user;
  if (!sessionUser || sessionUser.role !== "PLATFORM_ADMIN") redirect("/login");

  // Same DB re-check as requireOwner, so a deleted/demoted admin or a revoked session loses
  // access immediately instead of whenever the JWT happens to expire.
  const user = await loadSessionUser(sessionUser.id);
  if (
    !user ||
    user.role !== "PLATFORM_ADMIN" ||
    user.sessionVersion !== (sessionUser.sessionVersion ?? 0)
  ) {
    redirect("/force-logout");
  }
  return { userId: sessionUser.id, name: user.name, email: user.email };
}

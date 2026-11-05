import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole, type AdminRole } from "@/lib/roles";

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
      staffTenantId: true,
      tenant: { select: { id: true } },
    },
  }),
);

/** What a page or action gets once the session has been re-checked. */
export type TenantMember = {
  userId: string;
  tenantId: string;
  role: AdminRole;
  name: string;
  email: string;
};

/**
 * Where a logged-in member of this store goes when they are refused.
 *
 * NOT /login, and the difference matters. The JWT cookie is valid and proxy.ts (which reads only
 * the JWT) admits both admin roles to /admin, so sending a staff account to /login would bounce
 * it to homeForRole("STAFF") and straight back here — a redirect loop instead of a refusal. It
 * is also simply true: they are signed in, and this page is not theirs.
 */
const REFUSED = "/admin/no-access";

/**
 * Re-reads the session user and applies the checks that cannot be delegated to the JWT.
 *
 * mustChangePassword, whether the account still has a store at all, and whether this session was
 * revoked can all change after the token was issued (the platform admin resets the owner's
 * password, or deletes their store; an owner revokes a staff account) and must take effect on
 * the very next request, not just on next login.
 */
async function loadMember(opts?: { allowMustChange?: boolean }) {
  const session = await auth();
  const sessionUser = session?.user;
  if (!sessionUser || !isAdminRole(sessionUser.role)) redirect("/login");

  const user = await loadSessionUser(sessionUser.id);
  // An owner's store is the one they own; a staff member's is the one employing them. Exactly
  // one of the two is set, enforced by a CHECK constraint as well as here (D71).
  const tenantId = user?.tenant?.id ?? user?.staffTenantId ?? null;
  if (
    !user ||
    !tenantId ||
    !isAdminRole(user.role) ||
    // The role in the token must still be the role in the database. An owner demoted to staff
    // keeps a token that says STORE_OWNER until it expires, and that token must stop working.
    user.role !== sessionUser.role ||
    // An admin password reset bumps sessionVersion: every session issued before it — including
    // one an attacker holds — is dead, rather than being sent to /admin/change-password where
    // it could set a password of its own.
    user.sessionVersion !== (sessionUser.sessionVersion ?? 0)
  ) {
    // Not just redirect("/login"): the JWT cookie is still valid and still says the old role, so
    // proxy.ts would bounce them straight back into /admin, looping forever. /force-logout
    // clears the cookie first.
    redirect("/force-logout");
  }
  if (user.mustChangePassword && !opts?.allowMustChange) {
    redirect("/admin/change-password");
  }
  return {
    userId: sessionUser.id,
    tenantId,
    role: user.role,
    name: user.name,
    email: user.email,
  } satisfies TenantMember;
}

/**
 * Server-side role checks, repeated inside pages and actions in addition to
 * proxy.ts. tenantId comes from the session, never from request input.
 *
 * This still means *owner*. It was not widened to admit staff, even though staff reach some of
 * the pages that call it — renaming it across ~200 call sites two weeks before a launch is the
 * larger risk, and a guard that refuses too much fails in the safe direction. Pages and actions
 * that staff may use call `requireCapability` (lib/permissions.ts) instead.
 */
export async function requireOwner(opts?: { allowMustChange?: boolean }) {
  const member = await loadMember(opts);
  if (member.role !== "STORE_OWNER") redirect(REFUSED);
  return { userId: member.userId, tenantId: member.tenantId, name: member.name, email: member.email };
}

/**
 * Anyone who belongs to this store — owner or staff — with their role, so the caller can decide.
 *
 * Only for surfaces that genuinely serve both and differ only in what they render: the panel
 * layout and its navigation, the refusal page, the notifications screen. Everything that grants
 * an ability goes through `requireCapability`, which is deny-by-default; this one grants nothing
 * beyond "you work here".
 */
export async function requireTenantMember(opts?: { allowMustChange?: boolean }): Promise<TenantMember> {
  return loadMember(opts);
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

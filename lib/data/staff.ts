import { prisma } from "@/lib/prisma";

/**
 * Staff accounts, owned and managed by the store owner (D71, D73).
 *
 * `User` is not under RLS — login looks an account up by email before any tenant context
 * exists — so every function here carries the tenant in its WHERE clause and the caller gets it
 * from the session, never from a form. That is the same rule the rest of `lib/data` follows; it
 * is only more conspicuous here because this table has no policy behind it as a second line.
 *
 * There is no invitation email. The platform has never had outbound mail, and adding it two
 * weeks before a pilot is not a thing to do inside a staff feature — so the owner sets a first
 * password and gives it to the person, exactly as the platform admin does for owners, and
 * `mustChangePassword` makes them replace it on first login.
 */

export class StaffError extends Error {
  constructor(readonly code: "EMAIL_TAKEN" | "NOT_FOUND") {
    super(code);
  }
}

export type StaffAccount = {
  id: string;
  name: string;
  email: string;
  mustChangePassword: boolean;
  createdAt: Date;
};

export function listStaffAccounts(tenantId: string): Promise<StaffAccount[]> {
  return prisma.user.findMany({
    where: { role: "STAFF", staffTenantId: tenantId },
    select: { id: true, name: true, email: true, mustChangePassword: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function createStaffAccount(
  tenantId: string,
  input: { name: string; email: string; passwordHash: string },
): Promise<StaffAccount> {
  // Checked first for a useful message, and caught below as well: between the two, somebody
  // else may have taken the address, and `email` is unique across every role in the platform.
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) throw new StaffError("EMAIL_TAKEN");

  try {
    return await prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: input.passwordHash,
        role: "STAFF",
        staffTenantId: tenantId,
        mustChangePassword: true,
      },
      select: { id: true, name: true, email: true, mustChangePassword: true, createdAt: true },
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      throw new StaffError("EMAIL_TAKEN");
    }
    throw error;
  }
}

/**
 * Removes a staff account, and with it their access on the very next request.
 *
 * A delete rather than a disabled flag, and the session dies for free: `lib/session.ts` re-reads
 * the user on every render and action, so the row being gone sends the live session to
 * /force-logout immediately. Their devices, notification preferences and notification rows go
 * with them (every one of those relations cascades), which is the behaviour to want — a removed
 * person's phone must stop receiving this store's orders.
 *
 * Scoped by tenant, so one store cannot remove another's staff, and by role, so this can never
 * delete an owner or a platform admin however it is called.
 */
export async function revokeStaffAccount(tenantId: string, userId: string): Promise<boolean> {
  const { count } = await prisma.user.deleteMany({
    where: { id: userId, role: "STAFF", staffTenantId: tenantId },
  });
  return count > 0;
}

/** Reset a staff member's password to a new one they must change on next login. */
export async function resetStaffPassword(
  tenantId: string,
  userId: string,
  passwordHash: string,
): Promise<boolean> {
  const { count } = await prisma.user.updateMany({
    where: { id: userId, role: "STAFF", staffTenantId: tenantId },
    data: {
      passwordHash,
      mustChangePassword: true,
      // Every session issued before this reset is dead, including one somebody else holds.
      sessionVersion: { increment: 1 },
    },
  });
  return count > 0;
}

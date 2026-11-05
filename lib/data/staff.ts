import { recordAnalyticsAudit } from "@/lib/analytics/audit";
import { prisma } from "@/lib/prisma";

/**
 * Staff accounts, owned and managed by the store owner (D71, D73).
 *
 * `User` is not under RLS — login looks an account up by email before any tenant context
 * exists — so every function here carries the tenant in its WHERE clause and the caller gets it
 * from the session, never from a form. That is the same rule the rest of `lib/data` follows; it
 * is only more conspicuous here because this table has no policy behind it as a second line.
 *
 * Every write here records who did it. The audit row is written in this module rather than in
 * the server action, so that granting somebody access to a store's orders and customer details
 * cannot happen without a record — a caller cannot forget what it is not allowed to skip. That
 * is why `actor` is a required argument and not an option.
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

/** Who is making the change. Snapshotted into the log, so it survives the account. */
export type StaffActor = { userId: string; email: string };

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
  actor: StaffActor,
): Promise<StaffAccount> {
  // Checked first for a useful message, and caught below as well: between the two, somebody
  // else may have taken the address, and `email` is unique across every role in the platform.
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) throw new StaffError("EMAIL_TAKEN");

  try {
    const created = await prisma.user.create({
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
    await recordAudit(tenantId, actor, created.email, "added");
    return created;
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
export async function revokeStaffAccount(
  tenantId: string,
  userId: string,
  actor: StaffActor,
): Promise<boolean> {
  // Read first, so the log can name the address: after the delete there is nothing to look up.
  const existing = await prisma.user.findFirst({
    where: { id: userId, role: "STAFF", staffTenantId: tenantId },
    select: { email: true },
  });
  const { count } = await prisma.user.deleteMany({
    where: { id: userId, role: "STAFF", staffTenantId: tenantId },
  });
  if (count === 0) return false;
  await recordAudit(tenantId, actor, existing?.email ?? userId, "removed");
  return true;
}

/** Reset a staff member's password to a new one they must change on next login. */
export async function resetStaffPassword(
  tenantId: string,
  userId: string,
  passwordHash: string,
  actor: StaffActor,
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
  if (count === 0) return false;
  await recordAudit(tenantId, actor, userId, "password reset");
  return true;
}

/**
 * One line per change, in the platform's append-only log.
 *
 * The detail is one of three words and the subject is the account. A password never appears in
 * either — the log says that access changed and who changed it, which is the whole job.
 */
function recordAudit(
  tenantId: string,
  actor: StaffActor,
  subject: string,
  detail: "added" | "removed" | "password reset",
) {
  return recordAnalyticsAudit({
    tenantId,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: "STAFF_CHANGE",
    subject,
    detail,
  });
}

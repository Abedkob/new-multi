/**
 * The audit trail: who did what to a store's measurement settings, and when (§9.3, D36, D40).
 *
 * One writer for every kind of entry, because the value of this table is that nothing writes to
 * it in its own way. Phase 4 opened it for privacy requests; Phase 5 adds integration changes
 * and, later, platform-console views.
 *
 * `AnalyticsAuditLog` is deliberately outside RLS and deliberately unreadable by the store
 * owner. It is evidence *about* a store rather than data belonging to it, so an owner cannot
 * read, edit or erase the record of their own change — which is the whole reason logging the
 * owner's own edits is worth anything. The writes go through `withBypass` for the same reason.
 */
import { withBypass } from "@/lib/prisma";

export type AuditAction =
  | "PRIVACY_SUMMARY"
  | "PRIVACY_EXPORT"
  | "PRIVACY_ERASE"
  | "INTEGRATION_CHANGE";

export type AuditEntry = {
  tenantId: string | null;
  actorUserId: string | null;
  /** Snapshotted, so the record survives the account being deleted or renamed. */
  actorEmail: string;
  action: AuditAction;
  subject: string | null;
  detail: string | null;
};

export async function recordAnalyticsAudit(entry: AuditEntry): Promise<void> {
  await withBypass((db) =>
    db.analyticsAuditLog.create({
      data: {
        tenantId: entry.tenantId,
        actorUserId: entry.actorUserId,
        actorEmail: entry.actorEmail,
        action: entry.action,
        subject: entry.subject,
        detail: entry.detail?.slice(0, 500) ?? null,
      },
    }),
  );
}

/** A field's old and new value, as the log records them. */
export type IntegrationChange = { field: string; from: string | null; to: string | null };

/**
 * One row per integration write, naming the actor, the fields and their before and after values
 * (D40).
 *
 * The values are recorded in full, not masked. These are public identifiers: a GA4 measurement
 * id and a Meta pixel id ship in the page source of every storefront visit, and a verification
 * token is a `<meta>` tag anyone can read. Masking them would cost the log its only real use —
 * answering "what was it before?" when a merchant's tag stops reporting.
 *
 * Writes nothing when nothing changed, so re-saving a form unchanged leaves no row. A log that
 * fills up with non-events is a log nobody reads.
 */
export async function recordIntegrationChange(input: {
  tenantId: string;
  actorUserId: string | null;
  actorEmail: string;
  /** "owner" or "platform-admin": who the actor was acting as, not who they are. */
  actorRole: "owner" | "platform-admin";
  changes: readonly IntegrationChange[];
}): Promise<void> {
  if (input.changes.length === 0) return;
  await recordAnalyticsAudit({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    action: "INTEGRATION_CHANGE",
    subject: input.actorRole,
    detail: input.changes
      .map((c) => `${c.field}: ${c.from ?? "(none)"} -> ${c.to ?? "(none)"}`)
      .join("; "),
  });
}

/** Which fields actually changed between two integration snapshots. */
export function diffIntegrations(
  before: Readonly<Record<string, string | null>>,
  after: Readonly<Record<string, string | null | undefined>>,
): IntegrationChange[] {
  const changes: IntegrationChange[] = [];
  for (const [field, to] of Object.entries(after)) {
    if (to === undefined) continue;
    const from = before[field] ?? null;
    if ((from ?? null) !== (to ?? null)) changes.push({ field, from: from ?? null, to: to ?? null });
  }
  return changes;
}

/** The trail for one store, newest first — read by the platform console, never by the owner. */
export function listAnalyticsAudit(tenantId: string, take = 20) {
  return withBypass((db) =>
    db.analyticsAuditLog.findMany({
      where: { tenantId },
      orderBy: { at: "desc" },
      take,
    }),
  );
}

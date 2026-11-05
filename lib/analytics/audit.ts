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
  | "INTEGRATION_CHANGE"
  /** A platform admin opened the cross-store console (D43). One row per view, not per query. */
  | "PLATFORM_CONSOLE_VIEW";

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
    detail: formatIntegrationDetail(input.changes),
  });
}

/** The `detail` string's one and only format. `parseIntegrationFields` is its inverse. */
export const NONE = "(none)";

export function formatIntegrationDetail(changes: readonly IntegrationChange[]): string {
  return changes.map((c) => `${c.field}: ${c.from ?? NONE} -> ${c.to ?? NONE}`).join("; ");
}

/**
 * Which fields a logged write touched, read back out of `detail`.
 *
 * Parsing a string we wrote ourselves is not free of risk, so the writer and the reader sit next
 * to each other and `verify:integrations` round-trips them. The alternative — a column holding
 * the field list — would mean a migration and a second place for the same fact to live, and the
 * log would still have to carry the before/after values in prose for a person to read.
 *
 * Only the field NAMES come back. The values stay in the log: the screen that uses this says who
 * changed a field and when, not what it used to be.
 */
export function parseIntegrationFields(detail: string | null): string[] {
  if (!detail) return [];
  return detail
    .split("; ")
    .map((part) => part.split(":")[0]?.trim())
    .filter((field): field is string => !!field);
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

/** Who last changed one integration field, and when. Field names and an actor — never values. */
export type FieldProvenance = {
  /** The actor's name where we still have the account, otherwise the email we snapshotted. */
  actorLabel: string;
  /** "owner" or "platform-admin", as the write recorded it. */
  actorRole: string;
  at: Date;
};

/**
 * The newest change to each integration field, for the screens that edit them.
 *
 * This is the one narrow window onto the audit log that the owner's own panel is allowed, and
 * the shape is the reason it is allowed. P5-18a's rule is that the log is evidence *about* the
 * owner: they must not be able to read the trail, edit it or erase it. What this returns is who
 * last touched each field and when — three fields, newest only, for one store. There is no
 * route to the rest of the log from here: no values, no earlier changes, no other actions, no
 * other store, and nothing that writes or deletes.
 *
 * Added because "I did not change that" is the first thing said when a merchant's tag stops
 * reporting, and until now the answer was in a table only a platform admin could query (D40b).
 *
 * `withBypass`, because `AnalyticsAuditLog` is deliberately outside RLS.
 */
export async function lastIntegrationChanges(
  tenantId: string,
): Promise<Record<string, FieldProvenance>> {
  const rows = await withBypass((db) =>
    db.analyticsAuditLog.findMany({
      where: { tenantId, action: "INTEGRATION_CHANGE" },
      orderBy: { at: "desc" },
      // Enough to cover every field's most recent change many times over. A cap rather than
      // every row ever written: this answers "who last", not "what happened".
      take: 50,
      select: { at: true, subject: true, actorEmail: true, actorUserId: true, detail: true },
    }),
  );
  if (rows.length === 0) return {};

  // One lookup for the names, because the log snapshots the email (so it survives the account
  // being deleted) and a person reads their colleague's name.
  const ids = [...new Set(rows.map((r) => r.actorUserId).filter((id): id is string => !!id))];
  const names = new Map(
    ids.length === 0
      ? []
      : (
          await withBypass((db) =>
            db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
          )
        ).map((user) => [user.id, user.name]),
  );

  const latest: Record<string, FieldProvenance> = {};
  // Newest first, so the first row to mention a field is that field's last change.
  for (const row of rows) {
    const label = (row.actorUserId ? names.get(row.actorUserId) : null) || row.actorEmail;
    for (const field of parseIntegrationFields(row.detail)) {
      if (latest[field]) continue;
      latest[field] = { actorLabel: label, actorRole: row.subject ?? "", at: row.at };
    }
  }
  return latest;
}

/**
 * A platform admin opened the cross-store console (D43, P5-23).
 *
 * `tenantId` is null: the view is about every store at once, and attributing it to one of them
 * would be false. The period is recorded, because "who looked at what" without "when they were
 * looking at" answers half the question.
 *
 * Logged on the page's own render rather than in a middleware: the console is a server
 * component that reads the numbers, so the row is written exactly where the data is read and
 * cannot be bypassed by reaching the route another way.
 */
export async function recordPlatformConsoleView(input: {
  actorUserId: string | null;
  actorEmail: string;
  from: string;
  to: string;
  timeZone: string;
}): Promise<void> {
  await recordAnalyticsAudit({
    tenantId: null,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    action: "PLATFORM_CONSOLE_VIEW",
    subject: "platform-admin",
    detail: `period ${input.from}..${input.to} (${input.timeZone})`,
  });
}

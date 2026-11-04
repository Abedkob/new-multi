"use server";

/**
 * Acting on a shopper's privacy request (§4.7, D36).
 *
 * Platform admin only, and that is a decision rather than an accident of where the page sits.
 * A privacy request is a controller obligation: it arrives by email to the platform, has to be
 * answered within a deadline, and has to be logged. A store owner must not be able to erase a
 * visitor's trail on a whim — and an owner who could would also be able to destroy the evidence
 * that they had.
 *
 * Every call here writes an audit record, including the ones that only LOOK. Reading what a
 * store holds about an identified person is itself an access to personal data, and the question
 * "who looked" has to be answerable later.
 */

import { requirePlatformAdmin } from "@/lib/session";
import {
  erasePrivacyRequest,
  exportPrivacyRequest,
  recordPrivacyAudit,
  summarizePrivacyRequest,
  type PrivacyRequestSummary,
} from "@/lib/analytics/privacy-request";
import { getTenantBySlug } from "@/lib/data/tenants";

export type PrivacyRequestState = {
  error?: string;
  summary?: PrivacyRequestSummary;
  /** Pretty-printed JSON, shown for the admin to copy into their reply. */
  exported?: string;
  erased?: string;
};

/** A visitor id is a cuid; anything else is a typo, not a request. */
const looksLikeId = (value: string) => /^[a-z0-9]{20,40}$/i.test(value);

async function resolve(slug: string, raw: FormData) {
  const admin = await requirePlatformAdmin();
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { error: "Store not found." as const };

  const visitorId = String(raw.get("visitorId") ?? "").trim();
  if (!visitorId) return { error: "Paste the measurement id from the shopper's request." as const };
  if (!looksLikeId(visitorId)) {
    return {
      error:
        "That does not look like a measurement id. It is the value shown under " +
        "“Your measurement id” on the store's privacy page.",
    } as const;
  }
  return { admin, tenant, visitorId };
}

export async function summarizePrivacyRequestAction(
  slug: string,
  _prev: PrivacyRequestState,
  raw: FormData,
): Promise<PrivacyRequestState> {
  const resolved = await resolve(slug, raw);
  if ("error" in resolved) return { error: resolved.error };
  const { admin, tenant, visitorId } = resolved;

  const summary = await summarizePrivacyRequest(tenant.id, visitorId);
  await recordPrivacyAudit({
    tenantId: tenant.id,
    actorUserId: admin.userId,
    actorEmail: admin.email,
    action: "PRIVACY_SUMMARY",
    subject: visitorId,
    detail: summary.found
      ? `${summary.sessions} session(s), ${summary.events} event(s), ${summary.linkedOrders} linked order(s)`
      : "no such visitor for this store",
  });

  if (!summary.found) {
    return {
      summary,
      error:
        "This store holds nothing under that id. Either it belongs to another store — ids are " +
        "never shared between stores — or the data has already been deleted or aged out.",
    };
  }
  return { summary };
}

export async function exportPrivacyRequestAction(
  slug: string,
  _prev: PrivacyRequestState,
  raw: FormData,
): Promise<PrivacyRequestState> {
  const resolved = await resolve(slug, raw);
  if ("error" in resolved) return { error: resolved.error };
  const { admin, tenant, visitorId } = resolved;

  const data = await exportPrivacyRequest(tenant.id, visitorId);
  await recordPrivacyAudit({
    tenantId: tenant.id,
    actorUserId: admin.userId,
    actorEmail: admin.email,
    action: "PRIVACY_EXPORT",
    subject: visitorId,
    detail: `${data.sessions.length} session(s), ${data.events.length} event(s), ${data.retainedOrderIds.length} retained order(s)`,
  });

  return {
    summary: await summarizePrivacyRequest(tenant.id, visitorId),
    exported: JSON.stringify(data, null, 2),
  };
}

export async function erasePrivacyRequestAction(
  slug: string,
  _prev: PrivacyRequestState,
  raw: FormData,
): Promise<PrivacyRequestState> {
  const resolved = await resolve(slug, raw);
  if ("error" in resolved) return { error: resolved.error };
  const { admin, tenant, visitorId } = resolved;

  // Typing the id again is the confirmation. A destructive action should cost a deliberate act,
  // and a second copy of the id also catches the case where the wrong field was pasted into.
  if (String(raw.get("confirmVisitorId") ?? "").trim() !== visitorId) {
    return { error: "To erase, paste the same measurement id into the confirmation field." };
  }

  const result = await erasePrivacyRequest(tenant.id, visitorId);
  await recordPrivacyAudit({
    tenantId: tenant.id,
    actorUserId: admin.userId,
    actorEmail: admin.email,
    action: "PRIVACY_ERASE",
    subject: visitorId,
    detail: `${result.eventsDeleted} event(s), ${result.sessionsDeleted} session(s) deleted; ${result.ordersDetached} order(s) detached and kept`,
  });

  return {
    erased:
      `Deleted ${result.eventsDeleted} event(s) and ${result.sessionsDeleted} session(s). ` +
      `${result.ordersDetached} order(s) were detached from this id and KEPT, with their ` +
      `non-identifying details intact. Daily totals are unchanged — they are anonymous.`,
  };
}

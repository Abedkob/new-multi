/**
 * Consent receipts. Tenant-scoped like every other table in lib/data, so the write goes through
 * withTenant() and Row-Level Security applies to it.
 */

import { withTenant } from "@/lib/prisma";
import type { ConsentGrants, ConsentLocale, ConsentMethod } from "@/lib/consent/types";

export type ConsentReceiptInput = {
  noticeVersion: number;
  grants: ConsentGrants;
  locale: ConsentLocale;
  method: ConsentMethod;
  /** ISO alpha-2 from trusted proxy metadata, or null. Never an IP address. */
  country: string | null;
  /** "mobile" | "tablet" | "desktop", or null. Never a user-agent string. */
  deviceClass: string | null;
  expiresAt: Date;
};

/**
 * Records one decision and returns only its public reference — the single part of the row the
 * visitor is ever shown, so Cookie settings can display it without reading anything else back.
 */
export function recordConsentReceipt(tenantId: string, input: ConsentReceiptInput) {
  return withTenant(tenantId, (db) =>
    db.analyticsConsentReceipt.create({
      data: {
        tenantId,
        noticeVersion: input.noticeVersion,
        analyticsGranted: input.grants.analytics,
        advertisingGranted: input.grants.advertising,
        locale: input.locale,
        decisionMethod: input.method,
        country: input.country,
        deviceClass: input.deviceClass,
        expiresAt: input.expiresAt,
      },
      select: { publicRef: true },
    }),
  );
}

/** Most recent decisions for a store. Platform/verification use; not a visitor-facing view. */
export function listConsentReceipts(tenantId: string, take = 20) {
  return withTenant(tenantId, (db) =>
    db.analyticsConsentReceipt.findMany({
      where: { tenantId },
      orderBy: { decidedAt: "desc" },
      take,
    }),
  );
}

/**
 * How many consent decisions this store has ever recorded.
 *
 * Used by the owner's own Overview to tell "nothing has been counted yet" apart from "nobody
 * came" (P5-25): a store with no receipt at all has not had a visitor answer the banner, which
 * is a different problem from a quiet week. A count, never the rows — the Overview has no
 * business reading individual decisions.
 */
export function countConsentReceipts(tenantId: string) {
  return withTenant(tenantId, (db) => db.analyticsConsentReceipt.count({ where: { tenantId } }));
}

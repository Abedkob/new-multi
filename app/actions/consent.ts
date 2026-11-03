"use server";

/**
 * Recording a storefront visitor's consent decision.
 *
 * Two rules shape this file:
 *
 *  1. The visitor's choice is never lost. The signed cookie is written even if the receipt
 *     cannot be stored — a database problem or a rate limit must not cause us to keep measuring
 *     someone who just refused, nor to re-ask someone who just agreed.
 *  2. The browser is not believed about anything it does not own. The tenant is resolved from
 *     the slug, the grants for a fixed-meaning method are derived from the method itself, and
 *     country/device/expiry come from the request and the clock, not from the payload.
 */

import { cookies, headers } from "next/headers";
import { z } from "zod";
import {
  buildStoredConsent,
  consentCookieAttributes,
  consentCookieName,
  consentExpiry,
  encodeConsent,
} from "@/lib/consent/cookie";
import {
  consentCookiePath,
  requestCountry,
  requestDeviceClass,
  requestIsHttps,
  tenantLocale,
} from "@/lib/consent/read";
import {
  CONSENT_LOCALES,
  CONSENT_METHODS,
  METHOD_GRANTS,
  type ConsentGrants,
  type ConsentState,
} from "@/lib/consent/types";
import { recordConsentReceipt } from "@/lib/data/consent";
import { getTenantBySlug } from "@/lib/data/tenants";
import { RATE_LIMITS, clientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  slug: z.string().trim().min(1).max(120),
  method: z.enum(CONSENT_METHODS),
  locale: z.enum(CONSENT_LOCALES),
  // Only consulted for MANAGE; every other method has a fixed meaning (see METHOD_GRANTS).
  analytics: z.boolean(),
  advertising: z.boolean(),
});

export type ConsentActionResult =
  | { ok: true; state: ConsentState }
  | { ok: false; error: string };

export async function recordConsentAction(input: unknown): Promise<ConsentActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Could not record that choice." };
  const { slug, method, locale, analytics, advertising } = parsed.data;

  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { ok: false, error: "Could not record that choice." };

  // "Accept all" cannot record a refusal, and "Reject" cannot record a grant.
  const grants: ConsentGrants = METHOD_GRANTS[method] ?? { analytics, advertising };

  const ip = clientIp(await headers());
  const limit = await rateLimit(`consent:${ip}`, RATE_LIMITS.consent);

  const decidedAt = new Date();
  const expiresAt = consentExpiry(decidedAt);

  let publicRef: string | undefined;
  if (limit.ok) {
    try {
      const receipt = await recordConsentReceipt(tenant.id, {
        noticeVersion: tenant.consentNoticeVersion,
        grants,
        locale,
        method,
        country: await requestCountry(),
        deviceClass: await requestDeviceClass(),
        expiresAt,
      });
      publicRef = receipt.publicRef;
    } catch (error) {
      // Deliberately swallowed: see rule 1. The decision below still stands, and the store
      // keeps working. Logged without the payload (§12.1 forbids logging consent values).
      console.error(
        "consent receipt not stored:",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }

  const jar = await cookies();
  jar.set(
    consentCookieName(tenant.id),
    encodeConsent(
      buildStoredConsent({
        noticeVersion: tenant.consentNoticeVersion,
        grants,
        locale,
        publicRef,
      }),
    ),
    consentCookieAttributes({
      isHttps: await requestIsHttps(),
      storePath: consentCookiePath(tenant),
    }),
  );

  return {
    ok: true,
    state: { decided: true, grants, needsPrompt: false, locale, publicRef },
  };
}

/**
 * Clears the decision entirely, so the notice is shown again from scratch. Used by nothing in
 * the UI (withdrawal records a FOOTER_WITHDRAW refusal instead, which is the auditable act);
 * kept for the privacy-request path, where a visitor's stored decision should disappear rather
 * than become a recorded refusal.
 */
export async function forgetConsentAction(slug: string): Promise<void> {
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return;
  const jar = await cookies();
  jar.delete({
    name: consentCookieName(tenant.id),
    path: consentCookiePath(tenant),
  });
}

/** The locale the notice should open in for a store, for a first-render server component. */
export async function defaultConsentLocale(slug: string) {
  const tenant = await getTenantBySlug(slug);
  return tenant ? tenantLocale(tenant) : "en";
}

/**
 * Reading the consent decision on the server, plus the request facts a receipt is allowed to
 * record. Server-only (next/headers).
 *
 * Everything here is deliberately coarse. A receipt may say "someone in Lebanon, on a phone,
 * accepted analytics" — it may not say who. See §4.5 for the list of things that are never
 * stored; the shape of this file is that list made executable.
 */

import { cookies, headers } from "next/headers";
import { consentCookieName, decodeConsent } from "@/lib/consent/cookie";
import {
  type ConsentLocale,
  type ConsentState,
  consentState,
  isConsentLocale,
} from "@/lib/consent/types";
import { countryFrom, deviceClassFrom } from "@/lib/analytics/request";
import { getStoreBasePath } from "@/lib/store-url";

/** The tenant fields consent needs; a structural type so a `select`ed row fits. */
export type ConsentTenant = {
  id: string;
  slug: string;
  domain: string | null;
  consentNoticeVersion: number;
  defaultLocale: string;
};

/** Tenant.defaultLocale is a plain column; fall back rather than trust it blindly. */
export const tenantLocale = (tenant: Pick<ConsentTenant, "defaultLocale">): ConsentLocale =>
  isConsentLocale(tenant.defaultLocale) ? tenant.defaultLocale : "en";

/**
 * The visitor's decision for this store, or an undecided state that asks for one.
 *
 * The notice opens in the store's own default language when the visitor has never chosen; once
 * they have switched language inside the notice, their choice wins on later visits.
 */
export async function readStoreConsent(tenant: ConsentTenant): Promise<ConsentState> {
  const jar = await cookies();
  const raw = jar.get(consentCookieName(tenant.id))?.value;
  return consentState(decodeConsent(raw), tenant.consentNoticeVersion, tenantLocale(tenant));
}

/** Path the store's consent cookie is scoped to: its own origin root, or its /store/<slug>. */
export const consentCookiePath = (tenant: Pick<ConsentTenant, "slug" | "domain">): string =>
  getStoreBasePath(tenant) || "/";

/**
 * Whether this request arrived over HTTPS. Behind a reverse proxy the TLS terminates upstream,
 * so the forwarded protocol is the only truthful signal; absent both, assume plaintext (which
 * only ever relaxes the Secure attribute on a local http host — production forces it on anyway).
 */
export async function requestIsHttps(): Promise<boolean> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return proto === "https";
}

/**
 * Country and device class come from lib/analytics/request.ts, which holds the single
 * definition of what may be derived from a request. These wrappers exist only to read the
 * current request's headers for a Server Component or Server Action.
 */
export async function requestCountry(): Promise<string | null> {
  return countryFrom(await headers());
}

export type { DeviceClass } from "@/lib/analytics/request";

export async function requestDeviceClass() {
  return deviceClassFrom(await headers());
}

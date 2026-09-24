"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  EmailTakenError,
  deleteTenant,
  duplicateTenant,
  getTenantByDomain,
  getTenantBySlug,
  isUniqueViolation,
  resetOwnerPassword,
  setTenantPaused,
  updateTenantDomain,
  updateTenantFavicon,
  updateTenantIntegrations,
  updateTenantName,
} from "@/lib/data/tenants";
import {
  checkDomainResolves,
  inspectHostDns,
  isPlatformOwnHostname,
  type HostDnsReport,
} from "@/lib/domain-check";
import { isValidDomainFormat, normalizeHostname, wwwTwin } from "@/lib/domain-format";
import { env } from "@/lib/env";
import { generateTempPassword, hashPassword } from "@/lib/passwords";
import { activateTenantLicense } from "@/lib/license/service";
import { RATE_LIMITS, rateLimit, retryAfterText } from "@/lib/rate-limit";
import { requirePlatformAdmin } from "@/lib/session";
import { importImageFromUrl, isOwnImageUrl, storeImage } from "@/lib/storage";
import {
  analyticsSettingsSchema,
  createStoreSchema,
  domainFormSchema,
  isImageUrl,
  searchSettingsSchema,
  updateStoreSchema,
  type FormState,
} from "@/lib/validation";

/** Every page under the store's sidebar layout (overview checklist, domain, search...) plus the
 * stores list, which all show the values these actions change. */
function revalidateStore(slug: string) {
  revalidatePath(`/platform/stores/${slug}`, "layout");
  revalidatePath("/platform/stores");
}

export async function setStorePausedAction(
  slug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requirePlatformAdmin();
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { error: "Store not found." };
  if (tenant.isPaused) return { error: "This store is already paused." };

  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3 || reason.length > 500) {
    return { fieldErrors: { reason: ["Enter a reason between 3 and 500 characters."] } };
  }
  await setTenantPaused(tenant.id, reason);
  revalidateStore(slug);
  revalidatePath(`/store/${slug}`, "layout");
  return { ok: true };
}

export async function resumeStoreAction(
  slug: string,
  _prev: FormState,
  _formData: FormData,
): Promise<FormState> {
  await requirePlatformAdmin();
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { error: "Store not found." };
  if (!tenant.isPaused) return { error: "This store is already active." };
  await setTenantPaused(tenant.id, null);
  revalidateStore(slug);
  revalidatePath(`/store/${slug}`, "layout");
  return { ok: true };
}

export async function activateStoreLicenseAction(
  slug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requirePlatformAdmin();
  const parsed = z.object({
    licenseKey: z.string().trim().min(10).max(500),
  }).safeParse({ licenseKey: formData.get("licenseKey") });
  if (!parsed.success) {
    return { fieldErrors: { licenseKey: ["Enter a valid license key."] } };
  }

  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { error: "Store not found." };
  const result = await activateTenantLicense(tenant.id, parsed.data.licenseKey);
  revalidateStore(slug);
  return result.ok ? { ok: true } : { error: result.message };
}

export async function updateStoreAction(
  slug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requirePlatformAdmin();

  const parsed = updateStoreSchema.safeParse({
    storeName: formData.get("storeName"),
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { error: "Store not found." };

  await updateTenantName(tenant.id, parsed.data.storeName);
  revalidateStore(slug);
  return { ok: true };
}

export type DuplicateStoreState = FormState & {
  // Returned once in this action's response; never persisted or logged, same as store creation.
  credentials?: {
    storeName: string;
    slug: string;
    ownerEmail: string;
    tempPassword: string;
  };
};

export async function duplicateStoreAction(
  slug: string,
  _prev: DuplicateStoreState,
  formData: FormData,
): Promise<DuplicateStoreState> {
  await requirePlatformAdmin();

  const parsed = createStoreSchema.safeParse({
    storeName: formData.get("storeName"),
    ownerName: formData.get("ownerName"),
    ownerEmail: formData.get("ownerEmail"),
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const source = await getTenantBySlug(slug);
  if (!source) return { error: "Store not found." };

  const tempPassword = generateTempPassword();
  try {
    const { tenant, user } = await duplicateTenant(source.id, {
      ...parsed.data,
      passwordHash: await hashPassword(tempPassword),
    });
    revalidatePath("/platform/stores");
    return {
      ok: true,
      credentials: {
        storeName: tenant.name,
        slug: tenant.slug,
        ownerEmail: user.email,
        tempPassword,
      },
    };
  } catch (e) {
    if (e instanceof EmailTakenError) {
      return { fieldErrors: { ownerEmail: [e.message] } };
    }
    console.error("duplicateStore failed:", e instanceof Error ? e.message : e);
    return { error: "Could not duplicate the store. Please try again." };
  }
}

export type ResetPasswordState = FormState & {
  // Returned once; never persisted or logged, same as store creation.
  tempPassword?: string;
};

export async function resetOwnerPasswordAction(
  slug: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by useActionState
  _prev: ResetPasswordState,
): Promise<ResetPasswordState> {
  await requirePlatformAdmin();

  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { error: "Store not found." };

  const tempPassword = generateTempPassword();
  await resetOwnerPassword(tenant.ownerId, await hashPassword(tempPassword));
  return { ok: true, tempPassword };
}

export async function updateStoreDomainAction(
  slug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requirePlatformAdmin();

  const parsed = domainFormSchema.safeParse({ domain: formData.get("domain") });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { error: "Store not found." };

  const { domain } = parsed.data;

  if (domain === null) {
    await updateTenantDomain(tenant.id, null);
    // Without this, the page keeps showing the old status text and the form's defaultValue
    // (uncontrolled — set once at mount) resets to whatever it was on the original page load,
    // not the just-saved value, on the next submission's native-form-reset-like behavior.
    revalidateStore(slug);
    return { ok: true };
  }

  if (isPlatformOwnHostname(domain)) {
    return { fieldErrors: { domain: ["That's this platform's own address, not a store domain."] } };
  }

  // proxy.ts redirects a domain's www/apex twin to it, so the twin must not be another store's.
  const twin = wwwTwin(domain);
  const twinOwner = twin ? await getTenantByDomain(twin) : null;
  if (twinOwner && twinOwner.id !== tenant.id) {
    return { fieldErrors: { domain: [`${twin} is already connected to another store.`] } };
  }

  // Tenant.domain means "verified and live" everywhere it's read (sitemap, robots, canonicals,
  // proxy.ts's rewrite) — this DNS check is what keeps that true, not just a UI nicety.
  const check = await checkDomainResolves(domain);
  if (!check.ok) {
    return {
      fieldErrors: {
        domain: [
          check.reason === "no-dns"
            ? `${domain} doesn't resolve yet. Point its DNS A record at ${env.SERVER_PUBLIC_IP ?? "this server"} and try again.`
            : `${domain} resolves to ${check.resolvedIp}, not ${env.SERVER_PUBLIC_IP}. Fix its DNS A record and try again.`,
        ],
      },
    };
  }

  try {
    await updateTenantDomain(tenant.id, domain);
  } catch (e) {
    if (isUniqueViolation(e)) {
      return { fieldErrors: { domain: ["That domain is already connected to another store."] } };
    }
    throw e;
  }
  revalidateStore(slug);
  return { ok: true };
}

export async function deleteStoreAction(
  slug: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by useActionState
  _prev: FormState,
): Promise<FormState> {
  await requirePlatformAdmin();

  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { error: "Store not found." };

  await deleteTenant(tenant.id);
  redirect("/platform/stores");
}

export type DnsCheckState = {
  error?: string;
  expectedIp?: string | null;
  reports?: HostDnsReport[];
};

/**
 * Read-only DNS diagnostic for the Domain page: the domain typed in (connected or not yet) and
 * its www/apex twin, each with A/AAAA/CNAME/CAA. Changes nothing.
 */
export async function checkDnsAction(
  _prev: DnsCheckState,
  formData: FormData,
): Promise<DnsCheckState> {
  await requirePlatformAdmin();
  const domain = normalizeHostname(
    String(formData.get("domain") ?? "").replace(/^https?:\/\//i, "").replace(/[/?#].*$/, ""),
  );
  if (!isValidDomainFormat(domain)) return { error: "Enter a bare domain like acme.com." };
  const twin = wwwTwin(domain);
  const reports = await Promise.all([domain, ...(twin ? [twin] : [])].map(inspectHostDns));
  return { expectedIp: env.SERVER_PUBLIC_IP ?? null, reports };
}

export async function saveSearchSettingsAction(
  slug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requirePlatformAdmin();
  const parsed = searchSettingsSchema.safeParse({
    googleSiteVerification: formData.get("googleSiteVerification") ?? "",
  });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { error: "Store not found." };
  await updateTenantIntegrations(tenant.id, parsed.data);
  revalidateStore(slug);
  return { ok: true };
}

export async function saveAnalyticsSettingsAction(
  slug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requirePlatformAdmin();
  const field = (k: string) => formData.get(k) ?? "";
  const parsed = analyticsSettingsSchema.safeParse({
    gaMeasurementId: field("gaMeasurementId"),
    googleAdsId: field("googleAdsId"),
    googleAdsPurchaseLabel: field("googleAdsPurchaseLabel"),
    metaPixelId: field("metaPixelId"),
    metaDomainVerification: field("metaDomainVerification"),
  });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { error: "Store not found." };
  await updateTenantIntegrations(tenant.id, parsed.data);
  revalidateStore(slug);
  return { ok: true };
}

/** Branding section: the store's favicon. Empty clears it (back to the generated letter icon). */
export async function saveBrandingAction(
  slug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requirePlatformAdmin();
  const parsed = z
    .object({
      faviconUrl: z
        .string()
        .trim()
        .max(2000)
        .refine(isImageUrl, { message: "Must be an http(s) URL, or empty" }),
    })
    .safeParse({ faviconUrl: formData.get("faviconUrl") ?? "" });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { error: "Store not found." };
  await updateTenantFavicon(tenant.id, parsed.data.faviconUrl || null);
  revalidateStore(slug);
  revalidatePath(`/store/${slug}`, "layout");
  return { ok: true };
}

/** Upload an image into a store's storage, as the platform admin (the owner's version takes the
 * tenant from the session). */
export async function uploadStoreImageAction(
  slug: string,
  formData: FormData,
): Promise<{ url?: string; error?: string }> {
  await requirePlatformAdmin();
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { error: "Store not found." };
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Choose an image file." };
  return storeImage(tenant.id, file);
}

/** Copy the image behind a pasted link into a store's storage, as the platform admin. */
export async function importStoreImageAction(
  slug: string,
  link: string,
): Promise<{ url?: string; error?: string }> {
  await requirePlatformAdmin();
  if (typeof link !== "string" || !link.trim() || link.length > 2000) {
    return { error: "That doesn't look like a link." };
  }
  if (isOwnImageUrl(link.trim())) return { url: link.trim() };
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { error: "Store not found." };
  const limit = await rateLimit(`image-import:${tenant.id}`, RATE_LIMITS.imageImport);
  if (!limit.ok) {
    return { error: `Too many imports. Try again in ${retryAfterText(limit.retryAfterMs)}.` };
  }
  return importImageFromUrl(tenant.id, link);
}

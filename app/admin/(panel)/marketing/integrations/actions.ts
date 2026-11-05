"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { diffIntegrations, recordIntegrationChange } from "@/lib/analytics/audit";
import { getTenantById, updateTenantIntegrations } from "@/lib/data/tenants";
import { INTEGRATION_FORMATS, type IntegrationKey } from "@/lib/integrations";
import { requireCapability } from "@/lib/permissions";
import { ownerIntegrationsSchema, type FormState } from "@/lib/validation";

export type IntegrationsActionState = FormState & {
  values?: Record<IntegrationKey, string>;
};

const KEYS = Object.keys(INTEGRATION_FORMATS) as IntegrationKey[];

/**
 * The owner saves their own Google and Meta ids (D40).
 *
 * `requireCapability` gives the tenant id; the form never does. A tenant id in a hidden field is how
 * one store edits another's settings, and this action takes no store argument at all.
 *
 * Every write is audited with the actor, the fields and their before and after values — the
 * owner's writes as much as the platform admin's. That record is what makes it safe for two
 * parties to hold the same power, and the owner cannot read or erase it (see lib/analytics/
 * audit.ts).
 *
 * An empty field clears the integration, which is the only "off" switch the screen needs.
 */
export async function saveOwnerIntegrationsAction(
  _previous: IntegrationsActionState,
  formData: FormData,
): Promise<IntegrationsActionState> {
  const owner = await requireCapability("integrations:write");
  const submitted = Object.fromEntries(
    KEYS.map((key) => [key, String(formData.get(key) ?? "")]),
  ) as Record<IntegrationKey, string>;

  const parsed = ownerIntegrationsSchema.safeParse(submitted);
  if (!parsed.success) {
    return {
      error: "integrations.error.generic",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      // What they typed, not what we stored: a pasted snippet that failed must still be on
      // screen to be corrected, not silently replaced by an empty field.
      values: submitted,
    };
  }

  const before = await getTenantById(owner.tenantId);
  if (!before) return { error: "integrations.error.generic", values: submitted };

  await updateTenantIntegrations(owner.tenantId, parsed.data);
  await recordIntegrationChange({
    tenantId: owner.tenantId,
    actorUserId: owner.userId,
    actorEmail: owner.email,
    actorRole: "owner",
    changes: diffIntegrations(
      Object.fromEntries(KEYS.map((key) => [key, before[key] ?? null])),
      parsed.data,
    ),
  });

  revalidatePath("/admin/marketing/integrations");
  // The storefront renders these tags, so its cached pages have to be rebuilt or a saved id
  // appears to do nothing until something else happens to invalidate them.
  revalidatePath("/store", "layout");

  return {
    ok: true,
    // Echo what was STORED, so the field shows the id that was pulled out of the paste. Seeing
    // the snippet turn into "G-ABC123" is how an owner knows the extraction did what it says.
    values: Object.fromEntries(KEYS.map((key) => [key, parsed.data[key] ?? ""])) as Record<
      IntegrationKey,
      string
    >,
  };
}

import { notFound } from "next/navigation";
import { lastIntegrationChanges } from "@/lib/analytics/audit";
import { getTenantById } from "@/lib/data/tenants";
import { INTEGRATION_FORMATS, type IntegrationKey } from "@/lib/integrations";
import { requireOwner } from "@/lib/session";
import { getStoreUrl } from "@/lib/store-url";
import { IntegrationsForm } from "./integrations-form";

/**
 * Marketing -> Integrations (D40): the owner's own Google and Meta ids.
 *
 * Owner-only, and not by convention: `requireOwner` throws for a platform admin and for an
 * unauthenticated request, here and again inside the action. The platform admin has their own
 * route for the same fields, with the same validation and the same audit record.
 */
export default async function OwnerIntegrationsPage() {
  const { tenantId } = await requireOwner();
  const tenant = await getTenantById(tenantId);
  if (!tenant) notFound();

  const keys = Object.keys(INTEGRATION_FORMATS) as IntegrationKey[];
  // Who last changed each field, and when (D40b). This is the only window onto the audit log
  // the owner's panel has: an actor and a time, per field, newest only. The trail itself, the
  // old values, and everything that is not an integration change stay out of reach — the log is
  // evidence about this owner, including about them (P5-18a).
  const lastChanged = await lastIntegrationChanges(tenantId);
  // The host the store is actually reached at, which is what Meta and Google verify — not the
  // platform's own hostname, and not a guess (D40a).
  const storeHost = (() => {
    try {
      return new URL(getStoreUrl(tenant)).host;
    } catch {
      return null;
    }
  })();

  return (
    <IntegrationsForm
      defaults={
        Object.fromEntries(keys.map((key) => [key, tenant[key] ?? ""])) as Record<
          IntegrationKey,
          string
        >
      }
      storeHost={tenant.domain ? storeHost : null}
      lastChanged={Object.fromEntries(
        keys
          .filter((key) => lastChanged[key])
          .map((key) => [
            key,
            {
              actorLabel: lastChanged[key].actorLabel,
              actorRole: lastChanged[key].actorRole,
              // Serialized for the client component; formatted there in the reader's language.
              at: lastChanged[key].at.toISOString(),
            },
          ]),
      )}
    />
  );
}

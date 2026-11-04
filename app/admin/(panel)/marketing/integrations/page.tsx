import { notFound } from "next/navigation";
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
    />
  );
}

"use client";

import { useActionState } from "react";
import { Field, FormError } from "@/components/field";
import { SubmitButton } from "@/components/submit-button";
import { Separator } from "@/components/ui/separator";
import type { FormState } from "@/lib/validation";
import { saveAnalyticsSettingsAction } from "../actions";

export type AnalyticsFormValues = {
  gaMeasurementId: string | null;
  googleAdsId: string | null;
  googleAdsPurchaseLabel: string | null;
  metaPixelId: string | null;
  metaDomainVerification: string | null;
};

/** Who last changed one field, as the audit log recorded it (D40b). */
export type FieldHistory = { actorLabel: string; actorRole: string; at: string };

/**
 * The provenance line under a field.
 *
 * The same fact the owner sees on their own Integrations screen, from the same accessor — the
 * two must not be able to disagree about who changed a tag, since disagreeing is the entire
 * failure mode this line exists to settle.
 */
function LastChanged({ field, history }: { field: string; history?: FieldHistory }) {
  if (!history) return null;
  const when = new Date(history.at).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return (
    <p className="text-xs text-muted-foreground" data-last-changed={field}>
      Last changed by {history.actorLabel} on {when}
      {history.actorRole === "owner" ? " (the store owner)" : ""}.
    </p>
  );
}

export function AnalyticsForm({
  slug,
  initial,
  hasDomain,
  lastChanged = {},
}: {
  slug: string;
  initial: AnalyticsFormValues;
  hasDomain: boolean;
  lastChanged?: Partial<Record<keyof AnalyticsFormValues, FieldHistory>>;
}) {
  const [state, action] = useActionState<FormState, FormData>(
    saveAnalyticsSettingsAction.bind(null, slug),
    {},
  );
  const err = (k: keyof AnalyticsFormValues) => state.fieldErrors?.[k];

  return (
    <form action={action} className="grid max-w-xl gap-5" data-testid="analytics-form">
      <Field
        label="Google Analytics 4 — Measurement ID"
        name="gaMeasurementId"
        defaultValue={initial.gaMeasurementId ?? ""}
        placeholder="G-ABC123XYZ"
        errors={err("gaMeasurementId")}
      />
      <LastChanged field="gaMeasurementId" history={lastChanged.gaMeasurementId} />
      <Separator />
      <div className="grid items-start gap-4 sm:grid-cols-2">
        {/* Each field and its provenance line share a cell, or the two-column grid puts the
            line beside the field it describes instead of under it. */}
        <div className="grid gap-1.5">
          <Field
            label="Google Ads — tag ID"
            name="googleAdsId"
            defaultValue={initial.googleAdsId ?? ""}
            placeholder="AW-123456789"
            errors={err("googleAdsId")}
          />
          <LastChanged field="googleAdsId" history={lastChanged.googleAdsId} />
        </div>
        <div className="grid gap-1.5">
          <Field
            label="Google Ads — purchase conversion label"
            name="googleAdsPurchaseLabel"
            defaultValue={initial.googleAdsPurchaseLabel ?? ""}
            placeholder="AbC-dEfGhIjK"
            errors={err("googleAdsPurchaseLabel")}
            hint="Pasting AW-123456789/AbC-dEfGhIjK into either field works too."
          />
          <LastChanged field="googleAdsPurchaseLabel" history={lastChanged.googleAdsPurchaseLabel} />
        </div>
      </div>
      <Separator />
      <Field
        label="Meta Pixel (dataset) ID"
        name="metaPixelId"
        defaultValue={initial.metaPixelId ?? ""}
        placeholder="123456789012345"
        inputMode="numeric"
        errors={err("metaPixelId")}
      />
      <LastChanged field="metaPixelId" history={lastChanged.metaPixelId} />
      <Field
        label="Meta domain verification tag"
        name="metaDomainVerification"
        defaultValue={initial.metaDomainVerification ?? ""}
        placeholder='<meta name="facebook-domain-verification" content="..." />
      <LastChanged field="metaDomainVerification" history={lastChanged.metaDomainVerification} />'
        errors={err("metaDomainVerification")}
        hint={
          hasDomain
            ? "Paste the whole tag or just its content value."
            : "Only works once the store has its own domain — Meta verifies the domain, and without one the store shares the platform's."
        }
      />
      <FormError message={state.error} />
      {state.ok && (
        <p className="text-sm text-muted-foreground">
          Saved. The storefront uses the new IDs from the next page load.
        </p>
      )}
      <p className="text-xs text-muted-foreground">Leave a field empty to turn that integration off.</p>
      <div>
        <SubmitButton pendingText="Saving...">Save</SubmitButton>
      </div>
    </form>
  );
}

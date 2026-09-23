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

export function AnalyticsForm({
  slug,
  initial,
  hasDomain,
}: {
  slug: string;
  initial: AnalyticsFormValues;
  hasDomain: boolean;
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
      <Separator />
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field
          label="Google Ads — tag ID"
          name="googleAdsId"
          defaultValue={initial.googleAdsId ?? ""}
          placeholder="AW-123456789"
          errors={err("googleAdsId")}
        />
        <Field
          label="Google Ads — purchase conversion label"
          name="googleAdsPurchaseLabel"
          defaultValue={initial.googleAdsPurchaseLabel ?? ""}
          placeholder="AbC-dEfGhIjK"
          errors={err("googleAdsPurchaseLabel")}
          hint="Pasting AW-123456789/AbC-dEfGhIjK into either field works too."
        />
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
      <Field
        label="Meta domain verification tag"
        name="metaDomainVerification"
        defaultValue={initial.metaDomainVerification ?? ""}
        placeholder='<meta name="facebook-domain-verification" content="..." />'
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

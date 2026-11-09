"use client";

import { useActionState } from "react";
import { Field, FormError } from "@/components/field";
import { SubmitButton } from "@/components/submit-button";
import type { FormState } from "@/lib/validation";
import {
  pauseStoreAnalyticsAction,
  resumeStoreAnalyticsAction,
  saveStorePrivacyAction,
} from "../actions";

export type PrivacyFormValues = {
  privacyControllerName: string;
  privacyEmail: string;
  privacyPolicyUrl: string;
  defaultLocale: string;
  analyticsTimezone: string;
};

export function StorePrivacyForm({
  slug,
  values,
  timeZones,
}: {
  slug: string;
  values: PrivacyFormValues;
  timeZones: { value: string; label: string }[];
}) {
  const [state, action] = useActionState<FormState, FormData>(
    saveStorePrivacyAction.bind(null, slug),
    {},
  );

  return (
    <form action={action} className="grid max-w-xl gap-4">
      <Field
        label="Responsible business name"
        name="privacyControllerName"
        required
        defaultValue={values.privacyControllerName}
        hint="Shown to shoppers on this store's privacy page as the business responsible for it."
        errors={state.fieldErrors?.privacyControllerName}
      />
      <Field
        label="Privacy contact email"
        name="privacyEmail"
        type="email"
        required
        defaultValue={values.privacyEmail}
        hint="Where shoppers' privacy questions about this store go."
        errors={state.fieldErrors?.privacyEmail}
      />
      <Field
        label="Merchant privacy policy URL"
        name="privacyPolicyUrl"
        type="url"
        placeholder="https://"
        defaultValue={values.privacyPolicyUrl}
        hint="Optional. Leave empty if the merchant has none."
        errors={state.fieldErrors?.privacyPolicyUrl}
      />
      <SelectField
        label="Storefront language"
        name="defaultLocale"
        defaultValue={values.defaultLocale}
        hint="The language the cookie notice opens in. Shoppers can switch it themselves."
        options={[
          { value: "en", label: "English" },
          { value: "ar", label: "العربية (Arabic)" },
        ]}
        errors={state.fieldErrors?.defaultLocale}
      />
      <SelectField
        label="Reporting time zone"
        name="analyticsTimezone"
        defaultValue={values.analyticsTimezone}
        hint="Decides where this store's business day starts and ends. Changing it re-buckets future days only; past figures are not restated."
        options={timeZones}
        errors={state.fieldErrors?.analyticsTimezone}
      />
      <FormError message={state.error} />
      {state.ok && <p className="text-sm font-medium">Privacy settings saved.</p>}
      <div>
        <SubmitButton pendingText="Saving...">Save privacy settings</SubmitButton>
      </div>
    </form>
  );
}

/**
 * The analytics-only pause. Shaped like StorePauseControl on purpose — same reason-required
 * flow — but it stops measurement only and leaves the storefront selling.
 */
export function AnalyticsPauseControl({
  slug,
  pausedAt,
  pauseReason,
}: {
  slug: string;
  pausedAt: Date | null;
  pauseReason: string | null;
}) {
  const [pauseState, pauseAction] = useActionState<FormState, FormData>(
    pauseStoreAnalyticsAction.bind(null, slug),
    {},
  );
  const [resumeState, resumeAction] = useActionState<FormState, FormData>(
    resumeStoreAnalyticsAction.bind(null, slug),
    {},
  );

  if (pausedAt) {
    return (
      <div className="grid gap-3">
        <p className="text-sm">
          Measurement paused on{" "}
          {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(pausedAt)}{" "}
          UTC
          {pauseReason ? ` · ${pauseReason}` : ""}
        </p>
        <form action={resumeAction}>
          <FormError message={resumeState.error} />
          <SubmitButton pendingText="Resuming...">Resume measurement</SubmitButton>
        </form>
      </div>
    );
  }

  return (
    <form action={pauseAction} className="grid max-w-xl gap-3">
      <Field
        label="Reason"
        name="reason"
        required
        hint="Recorded with the pause. The storefront keeps selling; only measurement stops."
        errors={pauseState.fieldErrors?.reason}
      />
      <FormError message={pauseState.error} />
      <div>
        <SubmitButton pendingText="Pausing...">Pause measurement</SubmitButton>
      </div>
    </form>
  );
}

function SelectField({
  label,
  name,
  options,
  hint,
  errors,
  defaultValue,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  hint?: string;
  errors?: string[];
  defaultValue?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        aria-invalid={!!errors?.length}
        className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && !errors?.length && <p className="text-xs text-muted-foreground">{hint}</p>}
      {errors?.map((e) => (
        <p key={e} className="text-sm text-destructive">
          {e}
        </p>
      ))}
    </div>
  );
}

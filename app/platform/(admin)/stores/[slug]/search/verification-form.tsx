"use client";

import { useActionState } from "react";
import { Field, FormError } from "@/components/field";
import { SubmitButton } from "@/components/submit-button";
import type { FormState } from "@/lib/validation";
import { saveSearchSettingsAction } from "../actions";

export function VerificationForm({ slug, initial }: { slug: string; initial: string | null }) {
  const [state, action] = useActionState<FormState, FormData>(
    saveSearchSettingsAction.bind(null, slug),
    {},
  );
  return (
    <form action={action} className="grid max-w-xl gap-4">
      <Field
        label="Search Console HTML tag"
        name="googleSiteVerification"
        defaultValue={initial ?? ""}
        placeholder='<meta name="google-site-verification" content="..." />'
        errors={state.fieldErrors?.googleSiteVerification}
        hint="Paste the whole tag or just its content value. Leave empty to remove it."
      />
      <FormError message={state.error} />
      {state.ok && <p className="text-sm text-muted-foreground">Saved. Now click Verify in Search Console.</p>}
      <div>
        <SubmitButton pendingText="Saving...">Save</SubmitButton>
      </div>
    </form>
  );
}

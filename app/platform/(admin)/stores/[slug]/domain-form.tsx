"use client";

import { useActionState } from "react";
import { updateStoreDomainAction } from "./actions";
import { Field, FormError } from "@/components/field";
import { SubmitButton } from "@/components/submit-button";
import type { FormState } from "@/lib/validation";

export function DomainForm({
  slug,
  initialDomain,
}: {
  slug: string;
  initialDomain: string | null;
}) {
  const [state, action] = useActionState<FormState, FormData>(
    updateStoreDomainAction.bind(null, slug),
    {},
  );

  return (
    <form action={action} className="grid max-w-sm gap-4">
      <Field
        label="Custom domain"
        name="domain"
        placeholder="acme.com"
        defaultValue={initialDomain ?? ""}
        errors={state.fieldErrors?.domain}
        hint="Point its DNS A record at this server first, then connect it here. Add an A record for the www. (or bare) version too — it redirects here automatically. Leave empty to disconnect and fall back to /store/[slug]."
      />
      <FormError message={state.error} />
      {state.ok && <p className="text-sm text-muted-foreground">Saved.</p>}
      <div>
        <SubmitButton pendingText="Checking DNS...">Save domain</SubmitButton>
      </div>
    </form>
  );
}

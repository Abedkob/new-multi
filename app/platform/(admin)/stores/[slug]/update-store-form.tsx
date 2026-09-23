"use client";

import { useActionState } from "react";
import { updateStoreAction } from "./actions";
import { Field, FormError } from "@/components/field";
import { SubmitButton } from "@/components/submit-button";
import type { FormState } from "@/lib/validation";

export function UpdateStoreForm({
  slug,
  initialName,
}: {
  slug: string;
  initialName: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(
    updateStoreAction.bind(null, slug),
    {},
  );

  return (
    <form action={action} className="grid max-w-sm gap-4">
      <Field
        label="Store name"
        name="storeName"
        required
        defaultValue={initialName}
        errors={state.fieldErrors?.storeName}
      />
      <FormError message={state.error} />
      {state.ok && <p className="text-sm text-muted-foreground">Saved.</p>}
      <div>
        <SubmitButton pendingText="Saving...">Save name</SubmitButton>
      </div>
    </form>
  );
}

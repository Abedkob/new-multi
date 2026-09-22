"use client";

import { useActionState } from "react";
import { changePasswordAction } from "./actions";
import { Field, FormError } from "@/components/field";
import { SubmitButton } from "@/components/submit-button";

export function ChangePasswordForm() {
  const [state, action] = useActionState(changePasswordAction, {});
  return (
    <form action={action} className="grid gap-4">
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        hint="At least 8 characters."
        errors={state.fieldErrors?.password}
      />
      <Field
        label="Confirm new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.confirm}
      />
      <FormError message={state.error} />
      <SubmitButton pendingText="Updating...">Update password</SubmitButton>
    </form>
  );
}

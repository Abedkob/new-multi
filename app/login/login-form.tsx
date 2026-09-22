"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";
import { Field, FormError } from "@/components/field";
import { SubmitButton } from "@/components/submit-button";

export function LoginForm() {
  const [state, action] = useActionState(loginAction, {});
  return (
    <form action={action} className="grid gap-4">
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <FormError message={state.error} />
      <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
    </form>
  );
}

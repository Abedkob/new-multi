"use client";

import { useActionState } from "react";
import { changePasswordAction } from "./actions";
import { Field, FormError } from "@/components/field";
import { SubmitButton } from "@/components/submit-button";
import { resolveMessage, useT } from "@/lib/i18n/context";

export function ChangePasswordForm() {
  const [state, action] = useActionState(changePasswordAction, {});
  const t = useT();
  return (
    <form action={action} className="grid gap-4">
      <Field
        label={t("changePassword.newPasswordLabel")}
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        hint={t("changePassword.newPasswordHint")}
        errors={state.fieldErrors?.password?.map((e) => resolveMessage(t, e))}
      />
      <Field
        label={t("changePassword.confirmLabel")}
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.confirm?.map((e) => resolveMessage(t, e))}
      />
      <FormError message={state.error && resolveMessage(t, state.error)} />
      <SubmitButton pendingText={t("changePassword.updating")}>{t("changePassword.submit")}</SubmitButton>
    </form>
  );
}

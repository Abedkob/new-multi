"use client";

import { useActionState } from "react";
import { AffixField, FormActions, TextareaField } from "@/components/field";
import { SubmitButton } from "@/components/submit-button";
import { SectionCard } from "@/components/admin/section-card";
import { resolveMessage, useT } from "@/lib/i18n/context";
import { saveDeliverySettingsAction } from "./actions";

export function DeliverySettingsForm({
  defaults,
}: {
  defaults: { deliveryFee: string; deliveryNote: string };
}) {
  const [state, action] = useActionState(saveDeliverySettingsAction, {});
  const t = useT();
  const values = { ...defaults, ...state.values };
  const resolve = (messages?: string[]) => messages?.map((m) => resolveMessage(t, m));

  return (
    <form action={action} className="grid max-w-2xl gap-4">
      <SectionCard title={t("delivery.form.title")} bodyClassName="grid gap-5 p-4">
        {/* The currency affix's LTR placement lives in AffixField, with its reason. */}
        <AffixField
          label={t("delivery.form.feeLabel")}
          name="deliveryFee"
          inputMode="decimal"
          defaultValue={values.deliveryFee}
          prefix="$"
          hint={t("delivery.form.feeHelp")}
          errors={resolve(state.fieldErrors?.deliveryFee)}
          fieldClassName="max-w-xs"
        />
        <TextareaField
          label={t("delivery.form.noteLabel")}
          optional={t("common.optional")}
          name="deliveryNote"
          rows={3}
          defaultValue={values.deliveryNote}
          placeholder={t("delivery.form.notePlaceholder")}
          hint={t("delivery.form.noteHelp")}
          errors={resolve(state.fieldErrors?.deliveryNote)}
        />
      </SectionCard>

      <FormActions
        status={state.ok ? t("delivery.form.saved") : undefined}
        error={state.error && resolveMessage(t, state.error)}
      >
        <SubmitButton>{t("delivery.form.submit")}</SubmitButton>
      </FormActions>
    </form>
  );
}

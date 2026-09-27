"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  const feeErrors = state.fieldErrors?.deliveryFee;
  const noteErrors = state.fieldErrors?.deliveryNote;

  return (
    <form action={action} className="grid max-w-2xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("delivery.form.title")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-1.5">
            <Label htmlFor="deliveryFee">{t("delivery.form.feeLabel")}</Label>
            {/* Currency affix is intentionally LTR-positioned regardless of locale (see plan's
                numeric-formatting non-goal). */}
            <div className="relative max-w-xs">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                $
              </span>
              <Input
                id="deliveryFee"
                name="deliveryFee"
                inputMode="decimal"
                defaultValue={values.deliveryFee}
                className="pl-7 tabular-nums"
                aria-invalid={!!feeErrors?.length}
                aria-describedby={feeErrors?.length ? "deliveryFee-error" : "deliveryFee-help"}
              />
            </div>
            {!feeErrors?.length && (
              <p id="deliveryFee-help" className="text-xs text-muted-foreground">
                {t("delivery.form.feeHelp")}
              </p>
            )}
            {feeErrors?.map((message) => (
              <p id="deliveryFee-error" key={message} className="text-sm text-destructive">
                {resolveMessage(t, message)}
              </p>
            ))}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="deliveryNote">
              {t("delivery.form.noteLabel")} <span className="font-normal text-muted-foreground">{t("common.optional")}</span>
            </Label>
            <Textarea
              id="deliveryNote"
              name="deliveryNote"
              rows={3}
              defaultValue={values.deliveryNote}
              placeholder={t("delivery.form.notePlaceholder")}
              aria-invalid={!!noteErrors?.length}
              aria-describedby={noteErrors?.length ? "deliveryNote-error" : "deliveryNote-help"}
            />
            {!noteErrors?.length && (
              <p id="deliveryNote-help" className="text-xs text-muted-foreground">
                {t("delivery.form.noteHelp")}
              </p>
            )}
            {noteErrors?.map((message) => (
              <p id="deliveryNote-error" key={message} className="text-sm text-destructive">
                {resolveMessage(t, message)}
              </p>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-background px-4 py-3 sm:sticky sm:bottom-3 sm:z-10 sm:-mx-1 sm:bg-background/95 sm:shadow-lg sm:backdrop-blur">
        <SubmitButton>{t("delivery.form.submit")}</SubmitButton>
        {state.ok && <p role="status" className="text-sm text-green-700">{t("delivery.form.saved")}</p>}
        {state.error && <p role="alert" className="text-sm text-destructive">{resolveMessage(t, state.error)}</p>}
      </div>
    </form>
  );
}

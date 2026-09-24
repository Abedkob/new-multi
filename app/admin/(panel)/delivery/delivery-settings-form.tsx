"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveDeliverySettingsAction } from "./actions";

export function DeliverySettingsForm({
  defaults,
}: {
  defaults: { deliveryFee: string; deliveryNote: string };
}) {
  const [state, action] = useActionState(saveDeliverySettingsAction, {});
  const values = { ...defaults, ...state.values };
  const feeErrors = state.fieldErrors?.deliveryFee;
  const noteErrors = state.fieldErrors?.deliveryNote;

  return (
    <form action={action} className="grid max-w-2xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Delivery across Lebanon</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-1.5">
            <Label htmlFor="deliveryFee">Delivery fee</Label>
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
                This fixed fee applies to every order. Enter 0 for free delivery.
              </p>
            )}
            {feeErrors?.map((message) => (
              <p id="deliveryFee-error" key={message} className="text-sm text-destructive">
                {message}
              </p>
            ))}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="deliveryNote">Delivery note <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea
              id="deliveryNote"
              name="deliveryNote"
              rows={3}
              defaultValue={values.deliveryNote}
              placeholder="Usually delivered within 2–4 business days."
              aria-invalid={!!noteErrors?.length}
              aria-describedby={noteErrors?.length ? "deliveryNote-error" : "deliveryNote-help"}
            />
            {!noteErrors?.length && (
              <p id="deliveryNote-help" className="text-xs text-muted-foreground">
                Shown to customers in the cart, at checkout, and on their confirmation.
              </p>
            )}
            {noteErrors?.map((message) => (
              <p id="deliveryNote-error" key={message} className="text-sm text-destructive">
                {message}
              </p>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-background px-4 py-3 sm:sticky sm:bottom-3 sm:z-10 sm:-mx-1 sm:bg-background/95 sm:shadow-lg sm:backdrop-blur">
        <SubmitButton>Save delivery settings</SubmitButton>
        {state.ok && <p role="status" className="text-sm text-green-700">Delivery settings saved.</p>}
        {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      </div>
    </form>
  );
}

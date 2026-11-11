"use client";

import { useActionState } from "react";
import { FormError } from "@/components/field";
import { SubmitButton } from "@/components/submit-button";
import type { FormState } from "@/lib/validation";
import { disableStockAction, enableStockAction } from "../actions";

function formatUtc(value: Date) {
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(value)} UTC`;
}

/**
 * Modelled on CounterSalesControl, which is modelled on StorePauseControl: two forms rather than
 * one toggle, so each can refuse its own no-op and say what happened.
 *
 * The copy carries the two things the switch itself cannot say. Turning it off stops new movements
 * and leaves the history readable. And turning it on changes the product form: an owner who used
 * to type stock into it will find that number has moved to its own screen, which is the point —
 * saving a product is no longer able to overwrite a shelf somebody counted.
 */
export function StockControl({
  slug,
  enabled,
  firstEnabledAt,
  movements,
}: {
  slug: string;
  enabled: boolean;
  firstEnabledAt: Date | null;
  movements: number;
}) {
  const [enableState, enable] = useActionState<FormState, FormData>(
    enableStockAction.bind(null, slug),
    {},
  );
  const [disableState, disable] = useActionState<FormState, FormData>(
    disableStockAction.bind(null, slug),
    {},
  );

  if (enabled) {
    return (
      <div className="grid gap-3">
        <p className="text-sm">
          On{firstEnabledAt ? `, since ${formatUtc(firstEnabledAt)}` : ""}
          {movements > 0 ? ` · ${movements} movement${movements === 1 ? "" : "s"} recorded` : ""}
        </p>
        <p className="max-w-lg text-sm text-muted-foreground">
          Turning this off stops new movements being recorded and puts the stock field back on the
          product form. The store keeps its existing history, and the owner can still read it.
        </p>
        <form action={disable}>
          <FormError message={disableState.error} />
          {disableState.ok && (
            <p className="mb-2 text-sm text-muted-foreground">Stock management turned off.</p>
          )}
          <SubmitButton variant="outline" pendingText="Turning off...">
            Turn off stock management
          </SubmitButton>
        </form>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="max-w-lg text-sm text-muted-foreground">
        {firstEnabledAt
          ? "Off. This store has recorded stock movements before, and its history is still readable by the owner."
          : "Off. The owner's panel has no stockroom, and stock is edited on the product form as usual."}
      </p>
      <form action={enable}>
        <FormError message={enableState.error} />
        {enableState.ok && (
          <p className="mb-2 text-sm text-muted-foreground">Stock management turned on.</p>
        )}
        <SubmitButton pendingText="Turning on...">Turn on stock management</SubmitButton>
      </form>
    </div>
  );
}

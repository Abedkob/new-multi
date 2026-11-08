"use client";

import { useActionState } from "react";
import { FormError } from "@/components/field";
import { SubmitButton } from "@/components/submit-button";
import type { FormState } from "@/lib/validation";
import { disableCounterSalesAction, enableCounterSalesAction } from "../actions";

function formatUtc(value: Date) {
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(value)} UTC`;
}

/**
 * Modelled on StorePauseControl: two forms rather than one toggle, so each can refuse its own
 * no-op and say what happened.
 *
 * The copy carries one thing the switch cannot: turning the till off stops new sales and leaves
 * the receipts readable. An operator deciding whether to flip it should not have to guess that.
 */
export function CounterSalesControl({
  slug,
  enabled,
  firstEnabledAt,
  recordedSales,
}: {
  slug: string;
  enabled: boolean;
  firstEnabledAt: Date | null;
  recordedSales: number;
}) {
  const [enableState, enable] = useActionState<FormState, FormData>(
    enableCounterSalesAction.bind(null, slug),
    {},
  );
  const [disableState, disable] = useActionState<FormState, FormData>(
    disableCounterSalesAction.bind(null, slug),
    {},
  );

  if (enabled) {
    return (
      <div className="grid gap-3">
        <p className="text-sm">
          On{firstEnabledAt ? `, since ${formatUtc(firstEnabledAt)}` : ""}
          {recordedSales > 0 ? ` · ${recordedSales} sale${recordedSales === 1 ? "" : "s"} recorded` : ""}
        </p>
        <p className="max-w-lg text-sm text-muted-foreground">
          Turning this off stops new sales being recorded. The store keeps its existing receipts
          and takings, and the owner can still read them.
        </p>
        <form action={disable}>
          <FormError message={disableState.error} />
          {disableState.ok && (
            <p className="mb-2 text-sm text-muted-foreground">Counter sales turned off.</p>
          )}
          <SubmitButton variant="outline" pendingText="Turning off...">
            Turn off counter sales
          </SubmitButton>
        </form>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="max-w-lg text-sm text-muted-foreground">
        {firstEnabledAt
          ? "Off. This store has recorded counter sales before, and its history is still readable by the owner."
          : "Off. The owner's panel has no till."}
      </p>
      <form action={enable}>
        <FormError message={enableState.error} />
        {enableState.ok && (
          <p className="mb-2 text-sm text-muted-foreground">Counter sales turned on.</p>
        )}
        <SubmitButton pendingText="Turning on...">Turn on counter sales</SubmitButton>
      </form>
    </div>
  );
}

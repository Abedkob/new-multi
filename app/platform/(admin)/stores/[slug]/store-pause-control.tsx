"use client";

import { useActionState } from "react";
import { Field, FormError } from "@/components/field";
import { SubmitButton } from "@/components/submit-button";
import type { FormState } from "@/lib/validation";
import { resumeStoreAction, setStorePausedAction } from "./actions";

function formatUtc(value: Date) {
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(value)} UTC`;
}

export function StorePauseControl({
  slug,
  isPaused,
  pausedAt,
  pauseReason,
}: {
  slug: string;
  isPaused: boolean;
  pausedAt: Date | null;
  pauseReason: string | null;
}) {
  const [pauseState, pauseAction] = useActionState<FormState, FormData>(
    setStorePausedAction.bind(null, slug),
    {},
  );
  const [resumeState, resumeAction] = useActionState<FormState, FormData>(
    resumeStoreAction.bind(null, slug),
    {},
  );

  if (isPaused) {
    return (
      <div className="grid gap-3">
        <p className="text-sm">
          Paused {pausedAt ? `on ${formatUtc(pausedAt)}` : ""}
          {pauseReason ? ` · ${pauseReason}` : ""}
        </p>
        <form action={resumeAction}>
          <FormError message={resumeState.error} />
          {resumeState.ok && <p className="mb-2 text-sm text-muted-foreground">Store resumed.</p>}
          <SubmitButton variant="outline" pendingText="Resuming...">Resume store</SubmitButton>
        </form>
      </div>
    );
  }

  return (
    <form action={pauseAction} className="grid max-w-lg gap-4">
      <Field
        label="Reason (visible to platform admins only)"
        name="reason"
        maxLength={500}
        required
        errors={pauseState.fieldErrors?.reason}
      />
      <FormError message={pauseState.error} />
      {pauseState.ok && <p className="text-sm text-muted-foreground">Store paused.</p>}
      <div>
        <SubmitButton variant="destructive" pendingText="Pausing...">Pause storefront</SubmitButton>
      </div>
    </form>
  );
}

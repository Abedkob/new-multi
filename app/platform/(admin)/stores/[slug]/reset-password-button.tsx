"use client";

import { useState } from "react";
import { useActionState } from "react";
import { resetOwnerPasswordAction, type ResetPasswordState } from "./actions";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/field";
import { ConfirmSubmitButton } from "@/components/confirm-dialog";

function CopyButton({ getText, children }: { getText: () => string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(getText());
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "Copied!" : children}
    </Button>
  );
}

/** Shows a new temp password once. It cannot be shown again once this leaves the screen. */
export function ResetPasswordButton({
  slug,
  ownerEmail,
}: {
  slug: string;
  ownerEmail: string;
}) {
  const [state, action, pending] = useActionState<ResetPasswordState, FormData>(
    resetOwnerPasswordAction.bind(null, slug),
    {},
  );

  if (state.tempPassword) {
    return (
      <div className="grid gap-3 text-sm">
        <p className="text-muted-foreground">
          New password for {ownerEmail}. Copy it now — it cannot be shown again, and the
          owner must change it on next login.
        </p>
        <p data-testid="temp-password" className="font-mono text-base select-all">
          {state.tempPassword}
        </p>
        <div>
          <CopyButton getText={() => state.tempPassword!}>Copy password</CopyButton>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="grid justify-items-start gap-2">
      <ConfirmSubmitButton
        variant="outline"
        disabled={pending}
        destructive={false}
        title={`Reset the password for ${ownerEmail}?`}
        description="Their current password stops working immediately. You'll get a temporary one to send them."
        confirmLabel="Reset password"
      >
        {pending ? "Resetting..." : "Reset owner password"}
      </ConfirmSubmitButton>
      <FormError message={state.error} />
    </form>
  );
}

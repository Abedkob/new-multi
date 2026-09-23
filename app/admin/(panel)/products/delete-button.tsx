"use client";

import { useFormStatus } from "react-dom";
import { ConfirmSubmitButton } from "@/components/confirm-dialog";

export function DeleteButton({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <ConfirmSubmitButton
      variant="destructive"
      size="sm"
      disabled={pending}
      title={`Delete "${name}"?`}
      description="It disappears from your store straight away. Past orders keep their details. This can't be undone."
      confirmLabel="Delete product"
    >
      {pending ? "Deleting..." : "Delete"}
    </ConfirmSubmitButton>
  );
}

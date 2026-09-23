"use client";

import { useActionState } from "react";
import { deleteStoreAction } from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-dialog";
import { FormError } from "@/components/field";
import type { FormState } from "@/lib/validation";

export function DeleteStoreButton({
  slug,
  storeName,
  productCount,
  orderCount,
}: {
  slug: string;
  storeName: string;
  productCount: number;
  orderCount: number;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    deleteStoreAction.bind(null, slug),
    {},
  );

  return (
    <form action={action} className="grid justify-items-start gap-2">
      <ConfirmSubmitButton
        variant="destructive"
        disabled={pending}
        title={`Delete "${storeName}"?`}
        description={`This permanently deletes ${productCount} products, ${orderCount} orders and the owner account. This cannot be undone.`}
        confirmLabel="Delete store"
      >
        {pending ? "Deleting..." : "Delete store"}
      </ConfirmSubmitButton>
      <FormError message={state.error} />
    </form>
  );
}

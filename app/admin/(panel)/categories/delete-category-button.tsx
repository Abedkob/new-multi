"use client";

import { useActionState } from "react";
import { deleteCategoryAction } from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-dialog";

/** Shows the server's reason inline when deletion is blocked (children or products). */
export function DeleteCategoryButton({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(deleteCategoryAction.bind(null, id), {});
  return (
    <form action={action} className="grid justify-items-end gap-1">
      <ConfirmSubmitButton
        variant="destructive"
        size="sm"
        disabled={pending}
        title={`Delete "${name}"?`}
        description="The category is removed from your store's menu. A category that still has subcategories or products can't be deleted."
        confirmLabel="Delete category"
      >
        {pending ? "Deleting..." : "Delete"}
      </ConfirmSubmitButton>
      {state.error && (
        <p role="alert" className="max-w-xs text-right text-xs text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}

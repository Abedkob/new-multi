"use client";

import { useActionState } from "react";
import { deleteCategoryAction } from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-dialog";
import { resolveMessage, useT } from "@/lib/i18n/context";

/** Shows the server's reason inline when deletion is blocked (children or products). */
export function DeleteCategoryButton({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(deleteCategoryAction.bind(null, id), {});
  const t = useT();
  return (
    <form action={action} className="grid justify-items-end gap-1">
      <ConfirmSubmitButton
        variant="destructive"
        size="sm"
        disabled={pending}
        title={`${t("common.delete")} "${name}"?`}
        description={t("categories.delete.description")}
        confirmLabel={t("categories.delete.confirmLabel")}
        cancelLabel={t("common.cancel")}
      >
        {pending ? t("categories.delete.deleting") : t("common.delete")}
      </ConfirmSubmitButton>
      {state.error && (
        <p role="alert" className="max-w-xs text-end text-xs text-destructive">
          {resolveMessage(t, state.error)}
        </p>
      )}
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { deleteCategoryAction } from "./actions";
import { Button } from "@/components/ui/button";

/** Shows the server's reason inline when deletion is blocked (children or products). */
export function DeleteCategoryButton({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(deleteCategoryAction.bind(null, id), {});
  return (
    <form action={action} className="grid justify-items-end gap-1">
      <Button
        type="submit"
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={(e) => {
          if (!window.confirm(`Delete "${name}"?`)) e.preventDefault();
        }}
      >
        {pending ? "Deleting..." : "Delete"}
      </Button>
      {state.error && (
        <p role="alert" className="max-w-xs text-right text-xs text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}

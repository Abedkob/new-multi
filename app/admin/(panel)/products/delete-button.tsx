"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function DeleteButton({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="destructive"
      size="sm"
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) {
          e.preventDefault();
        }
      }}
    >
      {pending ? "Deleting..." : "Delete"}
    </Button>
  );
}

"use client";

import { Button } from "@/components/ui/button";

export function ArchiveDiscountButton({ name }: { name: string }) {
  return (
    <Button
      type="submit"
      size="sm"
      variant="outline"
      onClick={(event) => {
        if (!window.confirm(`Archive “${name}”? It will stop applying to products immediately.`)) {
          event.preventDefault();
        }
      }}
    >
      Archive
    </Button>
  );
}

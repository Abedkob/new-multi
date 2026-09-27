"use client";

import { Button } from "@/components/ui/button";
import { resolveMessage, useT } from "@/lib/i18n/context";
import { encodeMessage } from "@/lib/i18n/types";

export function ArchiveDiscountButton({ name }: { name: string }) {
  const t = useT();
  return (
    <Button
      type="submit"
      size="sm"
      variant="outline"
      onClick={(event) => {
        if (!window.confirm(resolveMessage(t, encodeMessage("discounts.archive.confirm", name)))) {
          event.preventDefault();
        }
      }}
    >
      {t("discounts.archive.label")}
    </Button>
  );
}

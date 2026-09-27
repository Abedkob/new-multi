"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Thumb } from "@/components/admin/thumb";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatPrice } from "@/lib/format";
import { resolveMessage, useT } from "@/lib/i18n/context";
import { encodeMessage } from "@/lib/i18n/types";
import { cn } from "@/lib/utils";
import { DiscountPricePreview } from "./discount-price-preview";

export type DiscountProductPickerItem = {
  id: string;
  name: string;
  imageUrl: string | null;
  regularPriceCents: number;
  discountedPriceCents: number;
  assigned: boolean;
  overlappingNames: string[];
};

function SaveSelectionButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t("discounts.picker.saving") : t("discounts.picker.saveSelection")}</Button>;
}

export function DiscountProductPicker({
  items,
  action,
}: {
  items: DiscountProductPickerItem[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState(() => new Set(items.filter((item) => item.assigned).map((item) => item.id)));
  const selectedCount = selected.size;
  const t = useT();

  const setItem = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <form action={action} className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {resolveMessage(t, encodeMessage("discounts.picker.selectedOfTotal", selectedCount, items.length))}
        </p>
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set(items.map((item) => item.id)))}>
            {t("discounts.picker.selectAll")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {t("discounts.picker.clearPage")}
          </Button>
        </div>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <div className="divide-y">
          {items.map((item) => {
            const checked = selected.has(item.id);
            return (
              <label
                key={item.id}
                className={cn(
                  "grid cursor-pointer grid-cols-[auto_2.5rem_minmax(0,1fr)] items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-inset sm:grid-cols-[auto_2.5rem_minmax(0,1fr)_auto]",
                  checked && "bg-muted/30",
                )}
              >
                <input type="hidden" name="visibleProductIds" value={item.id} />
                <input
                  type="checkbox"
                  name="selectedProductIds"
                  value={item.id}
                  checked={checked}
                  onChange={(event) => setItem(item.id, event.target.checked)}
                  className="size-4 accent-primary"
                />
                <Thumb src={item.imageUrl} className="size-10" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{item.name}</span>
                  {item.overlappingNames.length > 0 && (
                    <span className="block text-xs text-amber-700 dark:text-amber-400">
                      {resolveMessage(t, encodeMessage("discounts.picker.overlaps", item.overlappingNames.join(", ")))}
                    </span>
                  )}
                </span>
                <span className="col-start-3 text-sm sm:col-start-auto">
                  {checked ? (
                    <DiscountPricePreview regularPriceCents={item.regularPriceCents} discountedPriceCents={item.discountedPriceCents} />
                  ) : (
                    <span className="grid justify-items-start gap-0.5 sm:justify-items-end">
                      <span className="font-medium tabular-nums">{formatPrice(item.regularPriceCents)}</span>
                      <span className="text-xs text-muted-foreground">{t("discounts.picker.selectToApply")}</span>
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <SaveSelectionButton />
        <p className="text-xs text-muted-foreground">{t("discounts.picker.otherPagesUnchanged")}</p>
      </div>
    </form>
  );
}

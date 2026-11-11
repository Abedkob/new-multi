"use client";

import { useFormStatus } from "react-dom";
import { ConfirmSubmitButton } from "@/components/confirm-dialog";
import { useT } from "@/lib/i18n/context";

/**
 * Quiet until it is reached for.
 *
 * This was `variant="destructive"` — a red-tinted chip — sitting at equal weight beside Stock and
 * Edit on every row. On a full page of products that is twenty-five red chips, and the loudest
 * thing on the merchant's main catalogue screen was the one action they almost never want. The
 * ranking was upside down: Edit is what a row is for.
 *
 * Ghost, in the secondary text colour, turning destructive on hover and focus. Nothing is lost by
 * it — the label still reads "Delete", the confirmation still names the product and says whether
 * it can be undone — and the red is spent where it means something rather than printed down the
 * side of the page. The focus state carries the colour too, so a keyboard user reaching it gets
 * the same warning a pointer does.
 */
export function DeleteButton({ name }: { name: string }) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <ConfirmSubmitButton
      variant="ghost"
      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
      size="sm"
      disabled={pending}
      title={`${t("common.delete")} "${name}"?`}
      description={t("products.delete.description")}
      confirmLabel={t("products.delete.confirmLabel")}
      cancelLabel={t("common.cancel")}
    >
      {pending ? t("products.delete.deleting") : t("common.delete")}
    </ConfirmSubmitButton>
  );
}

"use client";

import { useFormStatus } from "react-dom";
import { ConfirmSubmitButton } from "@/components/confirm-dialog";
import { useT } from "@/lib/i18n/context";

export function DeleteButton({ name }: { name: string }) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <ConfirmSubmitButton
      variant="destructive"
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

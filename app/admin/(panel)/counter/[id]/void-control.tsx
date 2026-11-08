"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useT } from "@/lib/i18n/context";
import { voidCounterSaleAction } from "../actions";

/**
 * Rendered only for a role that holds `counter:void`. The action re-checks that itself, because
 * hiding a button is not a permission — this only keeps the screen honest about what it offers.
 *
 * The reason is required before the dialog opens, so the confirmation step is the last thing
 * between the owner and the stock moving, rather than one of two.
 */
export function VoidControl({ saleId }: { saleId: string }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startVoid] = useTransition();

  return (
    <div className="grid max-w-md gap-2">
      <label className="grid gap-1.5 text-sm" htmlFor="void-reason">
        {t("counter.sale.voidReason")}
        <Input
          id="void-reason"
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {errorKey && (
        <p role="alert" className="text-sm text-destructive">
          {t(errorKey as Parameters<typeof t>[0])}
        </p>
      )}
      <Button
        variant="destructive"
        className="justify-self-start"
        disabled={!reason.trim() || pending}
        onClick={() => setOpen(true)}
      >
        {pending ? t("counter.sale.voiding") : t("counter.sale.void")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("counter.sale.voidConfirm")}
        confirmLabel={t("counter.sale.void")}
        destructive
        onConfirm={() =>
          startVoid(async () => {
            const result = await voidCounterSaleAction(saleId, reason.trim());
            if (!result.ok) setErrorKey(result.errorKey);
          })
        }
      />
    </div>
  );
}

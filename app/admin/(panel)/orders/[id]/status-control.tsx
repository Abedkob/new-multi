"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateOrderStatusAction } from "../actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { resolveMessage, useT } from "@/lib/i18n/context";
import type { DictionaryKey } from "@/lib/i18n/dictionaries/en";
import { nextStatuses, type OrderStatusValue } from "@/lib/orders";

const STATUS_LABEL_KEYS: Record<OrderStatusValue, DictionaryKey> = {
  PENDING: "orders.status.PENDING",
  CONFIRMED: "orders.status.CONFIRMED",
  DELIVERED: "orders.status.DELIVERED",
  CANCELLED: "orders.status.CANCELLED",
};

const STATUS_NOTICE_KEYS: Partial<Record<OrderStatusValue, DictionaryKey>> = {
  DELIVERED: "orders.status.notice.DELIVERED",
  CANCELLED: "orders.status.notice.CANCELLED",
};

/** Only offers the statuses this order can actually move to. */
export function StatusControl({ id, status }: { id: string; status: OrderStatusValue }) {
  const router = useRouter();
  const t = useT();
  const options = nextStatuses(status);
  const [next, setNext] = useState<OrderStatusValue | "">(options[0] ?? "");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const save = (to: OrderStatusValue) => {
    setError(undefined);
    startTransition(async () => {
      const res = await updateOrderStatusAction(id, to);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  };

  if (options.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="status-final">
        {t(STATUS_NOTICE_KEYS[status] ?? "orders.status.notice.DELIVERED")}
      </p>
    );
  }

  return (
    <div className="grid max-w-sm gap-2">
      <Label htmlFor="next-status">{t("orders.status.changeLabel")}</Label>
      <div className="flex gap-2">
        <select
          id="next-status"
          value={next}
          onChange={(e) => setNext(e.target.value as OrderStatusValue)}
          className="h-8 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {options.map((s) => (
            <option key={s} value={s}>
              {t(STATUS_LABEL_KEYS[s])}
            </option>
          ))}
        </select>
        <Button
          type="button"
          disabled={pending || next === ""}
          variant={next === "CANCELLED" ? "destructive" : "default"}
          onClick={() => {
            if (!next) return;
            if (next === "CANCELLED") setConfirmCancel(true);
            else save(next);
          }}
        >
          {pending ? t("orders.status.saving") : t("orders.status.updateButton")}
        </Button>
      </div>
      {options.includes("CANCELLED") && (
        <p className="text-xs text-muted-foreground">{t("orders.status.cancelRestocksNote")}</p>
      )}
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t("orders.status.cancelConfirmTitle")}
        description={t("orders.status.cancelConfirmDescription")}
        confirmLabel={t("orders.status.cancelConfirmLabel")}
        cancelLabel={t("orders.status.keepOrder")}
        destructive
        onConfirm={() => save("CANCELLED")}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {resolveMessage(t, error)}
        </p>
      )}
    </div>
  );
}

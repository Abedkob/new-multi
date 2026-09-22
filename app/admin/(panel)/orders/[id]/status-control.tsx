"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateOrderStatusAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { STATUS_LABEL, nextStatuses, type OrderStatusValue } from "@/lib/orders";

/** Only offers the statuses this order can actually move to. */
export function StatusControl({ id, status }: { id: string; status: OrderStatusValue }) {
  const router = useRouter();
  const options = nextStatuses(status);
  const [next, setNext] = useState<OrderStatusValue | "">(options[0] ?? "");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  if (options.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="status-final">
        This order is {STATUS_LABEL[status].toLowerCase()} and can&apos;t be changed any more.
      </p>
    );
  }

  return (
    <div className="grid max-w-sm gap-2">
      <Label htmlFor="next-status">Change status</Label>
      <div className="flex gap-2">
        <select
          id="next-status"
          value={next}
          onChange={(e) => setNext(e.target.value as OrderStatusValue)}
          className="h-8 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {options.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <Button
          type="button"
          disabled={pending || next === ""}
          variant={next === "CANCELLED" ? "destructive" : "default"}
          onClick={() => {
            if (!next) return;
            if (next === "CANCELLED" && !window.confirm("Cancel this order? The items go back into stock.")) return;
            setError(undefined);
            startTransition(async () => {
              const res = await updateOrderStatusAction(id, next);
              if (res.error) setError(res.error);
              else router.refresh();
            });
          }}
        >
          {pending ? "Saving..." : "Update status"}
        </Button>
      </div>
      {options.includes("CANCELLED") && (
        <p className="text-xs text-muted-foreground">Cancelling puts the items back into stock.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

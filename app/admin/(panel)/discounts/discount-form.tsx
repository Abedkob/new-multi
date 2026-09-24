"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { DiscountActionState } from "./actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatPrice } from "@/lib/format";
import { applyDiscount } from "@/lib/pricing";
import type { DiscountFormInput } from "@/lib/validation";

type Defaults = DiscountFormInput;

const localDateTime = (iso: string) => {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const isoDateTime = (local: string) => (local ? new Date(local).toISOString() : "");

export function DiscountForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (input: DiscountFormInput) => Promise<DiscountActionState>;
  defaults: Defaults;
  submitLabel: string;
}) {
  const [state, setState] = useState<DiscountActionState>({});
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(defaults.name);
  const [type, setType] = useState<Defaults["type"]>(defaults.type);
  const [value, setValue] = useState(defaults.value);
  const [isEnabled, setEnabled] = useState(defaults.isEnabled);
  const [startsAt, setStartsAt] = useState(localDateTime(defaults.startsAt));
  const [endsAt, setEndsAt] = useState(localDateTime(defaults.endsAt));
  const errors = state.fieldErrors ?? {};
  const previewValue = type === "PERCENTAGE" ? Number(value) : Math.round(Number(value) * 100);
  const preview = Number.isFinite(previewValue) && previewValue > 0
    ? applyDiscount(10_000, {
        id: "preview",
        name,
        type,
        value: previewValue,
        isEnabled: true,
        startsAt: null,
        endsAt: null,
        archivedAt: null,
        createdAt: new Date(0),
      })
    : 10_000;

  const save = () => {
    setState({});
    startTransition(async () => {
      const result = await action({
        name,
        type,
        value,
        isEnabled,
        startsAt: isoDateTime(startsAt),
        endsAt: isoDateTime(endsAt),
      });
      if (result) setState(result);
    });
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="grid gap-5"
    >
      <Card>
        <CardHeader>
          <CardTitle>Discount</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="discount-name">Internal name</Label>
            <Input
              id="discount-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Summer sale"
              maxLength={120}
              aria-invalid={!!errors.name?.length}
            />
            <p className="text-xs text-muted-foreground">Only store administrators see this name.</p>
            {errors.name?.map((message) => <p key={message} className="text-sm text-destructive">{message}</p>)}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="discount-type">Discount type</Label>
            <select
              id="discount-type"
              value={type}
              onChange={(event) => {
                setType(event.target.value as Defaults["type"]);
                setValue("");
              }}
              className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="PERCENTAGE">Percentage</option>
              <option value="FIXED_AMOUNT">Fixed amount per unit</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="discount-value">{type === "PERCENTAGE" ? "Percentage off" : "Amount off each unit"}</Label>
            <div className="relative">
              {type === "FIXED_AMOUNT" && <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>}
              <Input
                id="discount-value"
                inputMode={type === "PERCENTAGE" ? "numeric" : "decimal"}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                className={type === "FIXED_AMOUNT" ? "pl-7" : "pr-8"}
                placeholder={type === "PERCENTAGE" ? "20" : "5.00"}
                aria-invalid={!!errors.value?.length}
              />
              {type === "PERCENTAGE" && <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">%</span>}
            </div>
            {errors.value?.map((message) => <p key={message} className="text-sm text-destructive">{message}</p>)}
          </div>
          <div className="rounded-lg border bg-muted/30 p-4 sm:col-span-2">
            <p className="text-xs font-medium text-muted-foreground">Example on a $100 item</p>
            <p className="mt-1 flex items-baseline gap-2 text-lg font-semibold tabular-nums">
              {preview < 10_000 && <span className="text-sm font-normal text-muted-foreground line-through">$100.00</span>}
              {formatPrice(preview)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="discount-start">Starts</Label>
            <Input id="discount-start" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} aria-invalid={!!errors.startsAt?.length} />
            <p className="text-xs text-muted-foreground">Leave empty to start immediately.</p>
            {errors.startsAt?.map((message) => <p key={message} className="text-sm text-destructive">{message}</p>)}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="discount-end">Ends</Label>
            <Input id="discount-end" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} aria-invalid={!!errors.endsAt?.length} />
            <p className="text-xs text-muted-foreground">Leave empty to keep it running.</p>
            {errors.endsAt?.map((message) => <p key={message} className="text-sm text-destructive">{message}</p>)}
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">Times are shown in your device&apos;s timezone and saved as an exact UTC time.</p>
          <div className="flex items-center justify-between gap-4 rounded-lg border p-4 sm:col-span-2">
            <div>
              <Label htmlFor="discount-enabled">Enable discount</Label>
              <p className="mt-1 text-xs text-muted-foreground">Scheduled dates only take effect while this is enabled.</p>
            </div>
            <Switch id="discount-enabled" checked={isEnabled} onCheckedChange={setEnabled} aria-label="Enable discount" />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-background px-4 py-3 sm:sticky sm:bottom-3 sm:z-10 sm:-mx-1 sm:bg-background/95 sm:shadow-lg sm:backdrop-blur">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
        <Link href="/admin/discounts" className={buttonVariants({ variant: "ghost" })}>Cancel</Link>
        {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      </div>
    </form>
  );
}

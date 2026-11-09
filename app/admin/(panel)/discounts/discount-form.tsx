"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { DiscountActionState } from "./actions";
import { AffixField, Field, FormActions, SelectField, SwitchField } from "@/components/field";
import { SectionCard } from "@/components/admin/section-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPrice } from "@/lib/format";
import { resolveMessage, useT } from "@/lib/i18n/context";
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
  const t = useT();
  const [name, setName] = useState(defaults.name);
  const [type, setType] = useState<Defaults["type"]>(defaults.type);
  const [value, setValue] = useState(defaults.value);
  const [isEnabled, setEnabled] = useState(defaults.isEnabled);
  const [startsAt, setStartsAt] = useState(localDateTime(defaults.startsAt));
  const [endsAt, setEndsAt] = useState(localDateTime(defaults.endsAt));
  const errors = state.fieldErrors ?? {};
  const resolve = (messages?: string[]) => messages?.map((m) => resolveMessage(t, m));
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
      <SectionCard title={t("discounts.form.title")} bodyClassName="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("discounts.form.internalNameLabel")}
          name="discount-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("discounts.form.namePlaceholder")}
          maxLength={120}
          hint={t("discounts.form.nameHelp")}
          errors={resolve(errors.name)}
          fieldClassName="sm:col-span-2"
        />
        <SelectField
          label={t("discounts.form.typeLabel")}
          name="discount-type"
          value={type}
          onChange={(event) => {
            setType(event.target.value as Defaults["type"]);
            setValue("");
          }}
          options={[
            { value: "PERCENTAGE", label: t("discounts.form.typePercentage") },
            { value: "FIXED_AMOUNT", label: t("discounts.form.typeFixed") },
          ]}
        />
        {/* The $/% affix is positioned LTR in both locales; AffixField holds that exemption and
            its reason, so this form carries no direction classes of its own. */}
        <AffixField
          label={
            type === "PERCENTAGE"
              ? t("discounts.form.percentageOffLabel")
              : t("discounts.form.amountOffLabel")
          }
          name="discount-value"
          inputMode={type === "PERCENTAGE" ? "numeric" : "decimal"}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          prefix={type === "FIXED_AMOUNT" ? "$" : undefined}
          suffix={type === "PERCENTAGE" ? "%" : undefined}
          placeholder={type === "PERCENTAGE" ? "20" : "5.00"}
          errors={resolve(errors.value)}
        />
        <div className="rounded-md border bg-background p-4 sm:col-span-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("discounts.form.exampleOn100")}
          </p>
          <p className="mt-1 flex items-baseline gap-2 text-lg font-semibold tabular-nums">
            {preview < 10_000 && (
              <span className="text-sm font-normal text-muted-foreground line-through">
                $100.00
              </span>
            )}
            {formatPrice(preview)}
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title={t("discounts.form.scheduleTitle")}
        bodyClassName="grid gap-4 sm:grid-cols-2"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="discount-start">{t("discounts.form.startsLabel")}</Label>
          <Input
            id="discount-start"
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            aria-invalid={!!errors.startsAt?.length || undefined}
          />
          <p className="text-xs text-muted-foreground">{t("discounts.form.startsHelp")}</p>
          {resolve(errors.startsAt)?.map((message) => (
            <p key={message} className="text-sm text-destructive">
              {message}
            </p>
          ))}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="discount-end">{t("discounts.form.endsLabel")}</Label>
          <Input
            id="discount-end"
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
            aria-invalid={!!errors.endsAt?.length || undefined}
          />
          <p className="text-xs text-muted-foreground">{t("discounts.form.endsHelp")}</p>
          {resolve(errors.endsAt)?.map((message) => (
            <p key={message} className="text-sm text-destructive">
              {message}
            </p>
          ))}
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          {t("discounts.form.timezoneNote")}
        </p>
        <SwitchField
          label={t("discounts.form.enableLabel")}
          name="discount-enabled"
          hint={t("discounts.form.enableHelp")}
          checked={isEnabled}
          onCheckedChange={setEnabled}
          aria-label={t("discounts.form.enableLabel")}
          className="sm:col-span-2"
        />
      </SectionCard>

      {/*
        This form drives a transition rather than a server action, so `useFormStatus` reports
        nothing and `SubmitButton` would never show its pending label (ADMIN_UI.md §5).
      */}
      <FormActions error={state.error && resolveMessage(t, state.error)}>
        <Button type="submit" disabled={pending}>
          {pending ? t("discounts.form.saving") : submitLabel}
        </Button>
        <Link href="/admin/discounts" className={buttonVariants({ variant: "ghost" })}>
          {t("common.cancel")}
        </Link>
      </FormActions>
    </form>
  );
}

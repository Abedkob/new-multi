"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Check, Copy, PackageSearch, Truck } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatPrice } from "@/lib/format";
import { resolveMessage, useT } from "@/lib/i18n/context";
import type { CouponFormInput } from "@/lib/validation";
import type { CouponActionState } from "./actions";

type ProductChoice = { id: string; name: string; imageUrl: string | null; basePriceCents: number };

const localDateTime = (iso: string) => {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const isoDateTime = (local: string) => local ? new Date(local).toISOString() : "";
const randomCode = () => `SAVE${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 5).toUpperCase()}`;

export function CouponForm({
  action, defaults, products, submitLabel, codeLocked = false, announcedCouponLabel,
}: {
  action: (input: CouponFormInput) => Promise<CouponActionState>;
  defaults: CouponFormInput;
  products: ProductChoice[];
  submitLabel: string;
  codeLocked?: boolean;
  announcedCouponLabel?: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<CouponActionState>({});
  const [name, setName] = useState(defaults.name);
  const [code, setCode] = useState(defaults.code);
  const [scope, setScope] = useState(defaults.scope);
  const [type, setType] = useState(defaults.type);
  const [value, setValue] = useState(defaults.value);
  const [enabled, setEnabled] = useState(defaults.isEnabled);
  const [startsAt, setStartsAt] = useState(localDateTime(defaults.startsAt));
  const [endsAt, setEndsAt] = useState(localDateTime(defaults.endsAt));
  const [showSchedule, setShowSchedule] = useState(Boolean(defaults.startsAt || defaults.endsAt));
  const [announced, setAnnounced] = useState(defaults.isAnnounced);
  const [announcementText, setAnnouncementText] = useState(defaults.announcementText || "Use {code} at checkout");
  const [productIds, setProductIds] = useState(new Set(defaults.productIds));
  const [query, setQuery] = useState("");
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [savedRevision, setSavedRevision] = useState(defaults.revision);
  const [dirty, setDirty] = useState(false);
  const errors = state.fieldErrors ?? {};

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [dirty]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return (q ? products.filter((product) => product.name.toLocaleLowerCase().includes(q)) : products).slice(0, 100);
  }, [products, query]);
  const selected = products.filter((product) => productIds.has(product.id));

  const save = () => {
    setState({});
    startTransition(async () => {
      const result = await action({
        name, code, scope, type, value, isEnabled: enabled,
        startsAt: showSchedule ? isoDateTime(startsAt) : "",
        endsAt: showSchedule ? isoDateTime(endsAt) : "",
        isAnnounced: announced,
        announcementText,
        productIds: [...productIds],
        revision: savedRevision,
      });
      if (result) {
        setState(result);
        if (result.ok) {
          setSavedRevision(result.revision);
          setDirty(false);
        }
      }
    });
  };
  const requestSave = () => {
    if (announced && announcedCouponLabel && !defaults.isAnnounced) setConfirmReplacement(true);
    else save();
  };
  const change = <T,>(setter: (next: T) => void, next: T) => { setter(next); setDirty(true); };
  const previewCode = code || "SAVE10";
  const resolvedAnnouncement = (announcementText || "Use {code} at checkout").includes("{code}")
    ? (announcementText || "Use {code} at checkout").replaceAll("{code}", previewCode)
    : `${announcementText} ${previewCode}`;

  return (
    <form onSubmit={(event) => { event.preventDefault(); requestSave(); }} className="grid gap-5">
      <Card>
        <CardHeader><CardTitle>{t("coupons.form.offerTitle")}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {([
            ["ORDER_SUBTOTAL", t("coupons.form.scopeOrder"), t("coupons.form.scopeOrderHelp"), Check],
            ["SELECTED_PRODUCTS", t("coupons.form.scopeProducts"), t("coupons.form.scopeProductsHelp"), PackageSearch],
            ["FREE_DELIVERY", t("coupons.form.scopeDelivery"), t("coupons.form.scopeDeliveryHelp"), Truck],
          ] as const).map(([option, label, help, Icon]) => (
            <label key={option} className={`cursor-pointer rounded-xl border p-4 transition-colors ${scope === option ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/40"}`}>
              <input type="radio" name="scope" value={option} checked={scope === option} onChange={() => change(setScope, option)} className="sr-only" />
              <Icon className="size-5" aria-hidden />
              <span className="mt-3 block font-medium">{label}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{help}</span>
            </label>
          ))}
        </CardContent>
      </Card>

      {scope !== "FREE_DELIVERY" && (
        <Card>
          <CardHeader><CardTitle>{t("coupons.form.amountTitle")}</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="coupon-type">{t("discounts.form.typeLabel")}</Label>
              <select id="coupon-type" value={type} onChange={(event) => change(setType, event.target.value as CouponFormInput["type"])} className="h-9 rounded-lg border bg-background px-3 text-sm">
                <option value="PERCENTAGE">{t("discounts.form.typePercentage")}</option>
                <option value="FIXED_AMOUNT">{t("discounts.form.typeFixed")}</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="coupon-value">{t("coupons.form.valueLabel")}</Label>
              <Input id="coupon-value" dir="ltr" value={value} onChange={(event) => change(setValue, event.target.value)} inputMode="decimal" placeholder={type === "PERCENTAGE" ? "10" : "5.00"} aria-invalid={!!errors.value?.length} />
              {errors.value?.map((error) => <p key={error} className="text-sm text-destructive">{resolveMessage(t, error)}</p>)}
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 text-sm sm:col-span-2">
              {type === "PERCENTAGE" ? t("coupons.form.percentExample").replace("{value}", value || "10") : t("coupons.form.fixedExample").replace("{value}", formatPrice(Math.max(0, Math.round(Number(value || 5) * 100))))}
            </div>
          </CardContent>
        </Card>
      )}

      {scope === "SELECTED_PRODUCTS" && (
        <Card>
          <CardHeader><CardTitle>{t("coupons.form.productsTitle")}</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("products.page.searchPlaceholder")} />
            {selected.length > 0 && <div className="flex flex-wrap gap-2">{selected.map((product) => <button key={product.id} type="button" onClick={() => { const next = new Set(productIds); next.delete(product.id); change(setProductIds, next); }} className="rounded-full border bg-muted px-3 py-1 text-xs">{product.name} ×</button>)}</div>}
            <div className="max-h-80 divide-y overflow-auto rounded-lg border">
              {filtered.map((product) => (
                <label key={product.id} className="flex cursor-pointer items-center gap-3 p-3 hover:bg-muted/40">
                  <input type="checkbox" checked={productIds.has(product.id)} onChange={(event) => { const next = new Set(productIds); if (event.target.checked) next.add(product.id); else next.delete(product.id); change(setProductIds, next); }} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{product.name}</span>
                  <span className="text-xs text-muted-foreground">{formatPrice(product.basePriceCents)}</span>
                </label>
              ))}
              {!filtered.length && <p className="p-6 text-center text-sm text-muted-foreground">{t("coupons.form.noProducts")}</p>}
            </div>
            {errors.productIds?.map((error) => <p key={error} role="alert" className="text-sm text-destructive">{resolveMessage(t, error)}</p>)}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>{t("coupons.form.identityTitle")}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="coupon-code">{t("coupons.form.codeLabel")}</Label>
            <div className="flex gap-2">
              <Input id="coupon-code" dir="ltr" value={code} readOnly={codeLocked} onChange={(event) => change(setCode, event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} aria-invalid={!!errors.code?.length} />
              {!codeLocked && <Button type="button" variant="outline" onClick={() => change(setCode, randomCode())}>{t("coupons.form.generate")}</Button>}
            </div>
            {codeLocked && <p className="text-xs text-muted-foreground">{t("coupons.form.codeLocked")}</p>}
            {errors.code?.map((error) => <p key={error} className="text-sm text-destructive">{resolveMessage(t, error)}</p>)}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="coupon-name">{t("coupons.form.nameLabel")}</Label>
            <Input id="coupon-name" value={name} onChange={(event) => change(setName, event.target.value)} placeholder={t("coupons.form.namePlaceholder")} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("coupons.form.availabilityTitle")}</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-4"><div><Label htmlFor="coupon-enabled">{t("coupons.form.enabledLabel")}</Label><p className="text-xs text-muted-foreground">{t("coupons.form.enabledHelp")}</p></div><Switch id="coupon-enabled" checked={enabled} onCheckedChange={(next) => change(setEnabled, next)} /></div>
          <Button type="button" variant="outline" className="w-fit" onClick={() => change(setShowSchedule, !showSchedule)}>{showSchedule ? t("coupons.form.hideSchedule") : t("coupons.form.showSchedule")}</Button>
          {showSchedule && <div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-1.5"><Label htmlFor="coupon-start">{t("discounts.form.startsLabel")}</Label><Input id="coupon-start" type="datetime-local" value={startsAt} onChange={(event) => change(setStartsAt, event.target.value)} /></div><div className="grid gap-1.5"><Label htmlFor="coupon-end">{t("discounts.form.endsLabel")}</Label><Input id="coupon-end" type="datetime-local" value={endsAt} onChange={(event) => change(setEndsAt, event.target.value)} />{errors.endsAt?.map((error) => <p key={error} className="text-sm text-destructive">{resolveMessage(t, error)}</p>)}</div></div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("coupons.form.announcementTitle")}</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center justify-between gap-4"><div><Label htmlFor="coupon-announced">{t("coupons.form.announcementLabel")}</Label><p className="text-xs text-muted-foreground">{t("coupons.form.announcementHelp")}</p></div><Switch id="coupon-announced" checked={announced} onCheckedChange={(next) => change(setAnnounced, next)} /></div>
          {announced && <><div className="grid gap-1.5"><Label htmlFor="coupon-announcement-text">{t("coupons.form.messageLabel")}</Label><Input id="coupon-announcement-text" value={announcementText} onChange={(event) => change(setAnnouncementText, event.target.value)} /><p className="text-xs text-muted-foreground">{t("coupons.form.codeTokenHelp")}</p></div><div className="flex items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-3 text-center text-sm text-background"><span>{resolvedAnnouncement}</span><Copy className="size-4" aria-hidden /></div></>}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-background px-4 py-3 sm:sticky sm:bottom-3 sm:z-10 sm:shadow-lg">
        <Button type="submit" disabled={pending}>{pending ? t("discounts.form.saving") : submitLabel}</Button>
        <Button type="button" variant="ghost" onClick={() => dirty ? setConfirmCancel(true) : router.push("/admin/discounts/coupons")}>{t("common.cancel")}</Button>
        {dirty && <span className="text-xs text-muted-foreground">{t("coupons.form.unsaved")}</span>}
        {state.ok && <p role="status" className="text-sm text-emerald-700">{t("coupons.form.saved")}</p>}
        {state.error && <p role="alert" className="text-sm text-destructive">{resolveMessage(t, state.error)}</p>}
      </div>
      <ConfirmDialog open={confirmReplacement} onOpenChange={setConfirmReplacement} title={t("coupons.form.replaceTitle")} description={t("coupons.form.replaceDescription").replace("{coupon}", announcedCouponLabel || "")} confirmLabel={t("coupons.form.replaceConfirm")} onConfirm={save} />
      <ConfirmDialog open={confirmCancel} onOpenChange={setConfirmCancel} title={t("coupons.form.discardTitle")} description={t("coupons.form.discardDescription")} confirmLabel={t("coupons.form.discardConfirm")} destructive onConfirm={() => router.push("/admin/discounts/coupons")} />
    </form>
  );
}

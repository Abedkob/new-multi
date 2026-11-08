"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/segmented";
import { useT } from "@/lib/i18n/context";
import { formatPrice } from "@/lib/format";
import { maxManualDiscountCents } from "@/lib/counter-sales";
import type { TillItem } from "@/lib/data/counter-sales";
import type { AdminRole } from "@/lib/roles";
import { recordCounterSaleAction, searchTillItemsAction } from "../actions";

/**
 * The whole till, in one screen and one client component.
 *
 * Three decisions worth knowing:
 *
 *  1. The search goes through a server action, not a `?q=` URL param. The products list uses the
 *     param and is right to — but here a server-component re-render would remount this component
 *     and empty the cart, and a cashier losing a half-rung sale because they searched for the
 *     next item is the worst bug this screen could have.
 *  2. The submission id is minted once per cart and only replaced after a sale is recorded. A
 *     double tap, or a retry after the network dropped on a request that actually committed,
 *     reaches the server with the same id and is answered with the same sale.
 *  3. A reduction is held as the TEXT the cashier typed, not as cents. Re-formatting a controlled
 *     money field on every keystroke makes it impossible to type: "2" becomes "2.00", so the "."
 *     of "2.50" lands after it and the field never leaves 2. The cents are derived on read, and
 *     the two rules the server and the database enforce — a ceiling by role, and a reason for any
 *     reduction — are checked here too, so a refusal does not arrive after the money is in the
 *     drawer.
 */

type Line = {
  variantId: string;
  productName: string;
  variantLabel: string;
  unitPriceCents: number;
  regularPriceCents: number;
  stock: number;
  quantity: number;
  /** What the cashier typed, in whole currency units. "" means no reduction. */
  reduceText: string;
  reduceReason: string;
};

/** The typed reduction in cents. Anything that is not a positive number is no reduction. */
function parseCents(text: string): number {
  const value = Number.parseFloat(text.trim().replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100);
}

function newSubmissionId() {
  // crypto.randomUUID needs a secure context. Admin is https in production, but this project has
  // already been bitten by that assumption off localhost, so there is a fallback.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      /* fall through */
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function Till({ role }: { role: AdminRole }) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<TillItem[] | null>(null);
  const [searching, startSearch] = useTransition();
  const [lines, setLines] = useState<Line[]>([]);
  const [payment, setPayment] = useState("CASH");
  const [submissionId, setSubmissionId] = useState(newSubmissionId);
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  /** What the server said about the refusal, in numbers, so the screen need not guess. */
  const [errorNote, setErrorNote] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<{ saleId: string; totalCents: number } | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);

  // Debounced, so a cashier typing a product name does not spend a query per keystroke.
  useEffect(() => {
    const term = search.trim();
    // No state is cleared here: an empty box is a derived condition (see `visible` below), and
    // clearing it from an effect is both an extra render and a lint error.
    if (!term) return;
    const timer = setTimeout(() => {
      startSearch(async () => {
        const result = await searchTillItemsAction(term);
        if (result.ok) setResults(result.items);
        else setErrorKey(result.errorKey);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  // Derived rather than stored: with an empty box there is nothing to show, whatever the last
  // search returned.
  const visible = search.trim() ? results : null;

  /** Each line with its reduction resolved and judged. The cart's one source of truth. */
  const priced = lines.map((line) => {
    const cap = maxManualDiscountCents(role, line.unitPriceCents);
    const wanted = parseCents(line.reduceText);
    const overCap = wanted > cap;
    const needsReason = wanted > 0 && line.reduceReason.trim() === "";
    // Over the cap, the line is shown at its full price: the sale cannot be completed in that
    // state, so quietly charging the capped amount would be inventing a total nobody chose.
    const reduceCents = overCap ? 0 : wanted;
    return {
      line,
      cap,
      overCap,
      needsReason,
      reduceCents,
      lineTotalCents: Math.max(0, line.unitPriceCents - reduceCents) * line.quantity,
    };
  });

  const total = priced.reduce((sum, p) => sum + p.lineTotalCents, 0);
  const blocked = priced.some((p) => p.overCap || p.needsReason);

  function clearError() {
    setErrorKey(null);
    setErrorNote(null);
  }

  function addItem(item: TillItem) {
    clearError();
    setLines((current) => {
      // The same variant twice is one line with a bigger quantity, which is what the server does
      // with it too — so what the cashier sees matches what is recorded.
      const existing = current.find((l) => l.variantId === item.variantId);
      if (existing) {
        return current.map((l) =>
          l.variantId === item.variantId
            ? { ...l, quantity: Math.min(99, Math.min(l.stock, l.quantity + 1)) }
            : l,
        );
      }
      return [
        ...current,
        {
          variantId: item.variantId,
          productName: item.productName,
          variantLabel: item.variantLabel,
          unitPriceCents: item.finalPriceCents,
          regularPriceCents: item.regularPriceCents,
          stock: item.stock,
          quantity: 1,
          reduceText: "",
          reduceReason: "",
        },
      ];
    });
  }

  function update(variantId: string, patch: Partial<Line>) {
    setLines((current) =>
      current.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l)),
    );
  }

  async function complete() {
    if (lines.length === 0 || pending || blocked) return;
    setPending(true);
    clearError();
    const result = await recordCounterSaleAction({
      submissionId,
      payment,
      lines: priced.map((p) => ({
        variantId: p.line.variantId,
        quantity: p.line.quantity,
        manualDiscountCents: p.reduceCents,
        manualDiscountReason: p.line.reduceReason.trim() || null,
      })),
      expectedTotalCents: total,
    });
    setPending(false);
    if (result.ok) {
      setRecorded({ saleId: result.saleId, totalCents: result.totalCents });
      return;
    }
    setErrorKey(result.errorKey);
    // The action already carries the figures behind a refusal. Saying "not enough stock" without
    // the number leaves the cashier to guess at the shelf with a customer waiting.
    const detail = result.detail;
    if (detail?.available !== undefined) {
      setErrorNote(`${t("counter.error.stockLeft")} ${detail.available}`);
    } else if (detail?.actualCents !== undefined) {
      setErrorNote(`${t("counter.error.newTotal")} ${formatPrice(detail.actualCents)}`);
    } else {
      setErrorNote(null);
    }
  }

  function startAnother() {
    setLines([]);
    setSearch("");
    setResults(null);
    setPayment("CASH");
    // A new cart is a new submission. Until this point a retry is the SAME sale.
    setSubmissionId(newSubmissionId());
    setRecorded(null);
    clearError();
    searchBox.current?.focus();
  }

  if (recorded) {
    return (
      <div data-testid="till-recorded" className="grid max-w-md gap-4 rounded-lg border p-6">
        <p className="text-lg font-medium">{t("counter.new.recorded")}</p>
        {/* The server's figure, not the cart's: what was charged is what it recorded. */}
        <p className="text-3xl font-semibold tabular-nums">{formatPrice(recorded.totalCents)}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={startAnother}>{t("counter.new.another")}</Button>
          <Link
            href={`/admin/counter/${recorded.saleId}`}
            className={buttonVariants({ variant: "outline" })}
          >
            {t("counter.new.viewReceipt")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* ---- find it ---- */}
      <section className="grid content-start gap-3">
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="till-search">
          {t("counter.new.searchLabel")}
          <Input
            id="till-search"
            ref={searchBox}
            value={search}
            autoFocus
            autoComplete="off"
            placeholder={t("counter.new.searchPlaceholder")}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              // A barcode scanner is out of scope, but a cashier who typed a name and sees one
              // row expects Enter to take it. Nothing else on this screen uses Enter.
              if (e.key !== "Enter") return;
              e.preventDefault();
              const first = visible?.find((item) => item.stock > 0);
              if (first) addItem(first);
            }}
          />
        </label>

        {searching && <p className="text-sm text-muted-foreground">{t("counter.new.searching")}</p>}
        {!search.trim() && (
          <p className="text-sm text-muted-foreground">{t("counter.new.searchHint")}</p>
        )}
        {visible?.length === 0 && !searching && (
          <p className="text-sm text-muted-foreground">{t("counter.new.noResults")}</p>
        )}

        <ul className="grid gap-2">
          {visible?.map((item) => (
            <li
              key={item.variantId}
              data-testid="till-result"
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {item.productName}
                  {item.variantLabel ? ` · ${item.variantLabel}` : ""}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatPrice(item.finalPriceCents)}
                  {item.finalPriceCents !== item.regularPriceCents && (
                    <span className="ms-2 line-through">{formatPrice(item.regularPriceCents)}</span>
                  )}
                  {" · "}
                  {item.stock > 0
                    ? `${item.stock} ${t("counter.new.inStock")}`
                    : t("counter.new.outOfStock")}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                data-testid="till-add"
                disabled={item.stock <= 0}
                onClick={() => addItem(item)}
              >
                {t("counter.new.add")}
              </Button>
            </li>
          ))}
        </ul>
      </section>

      {/* ---- sell it ---- */}
      <section className="grid content-start gap-3 md:sticky md:top-4">
        <h2 className="text-sm font-medium">
          {t("counter.new.cart")}
          {lines.length > 0 && (
            <span className="ms-1 font-normal text-muted-foreground tabular-nums">
              ({lines.length})
            </span>
          )}
        </h2>
        {lines.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("counter.new.cartEmpty")}</p>
        )}

        <ul className="grid gap-3">
          {priced.map(({ line, cap, overCap, needsReason, reduceCents, lineTotalCents }) => (
            <li
              key={line.variantId}
              data-testid="till-line"
              className="grid gap-2 rounded-lg border p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium">
                  {line.productName}
                  {line.variantLabel ? ` · ${line.variantLabel}` : ""}
                </p>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("counter.new.remove")}
                  onClick={() =>
                    setLines((current) => current.filter((l) => l.variantId !== line.variantId))
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="flex items-center gap-1"
                  role="group"
                  aria-label={t("counter.new.quantity")}
                >
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="-"
                    disabled={line.quantity <= 1}
                    onClick={() => update(line.variantId, { quantity: line.quantity - 1 })}
                  >
                    <Minus className="size-4" />
                  </Button>
                  <span className="w-8 text-center text-sm tabular-nums">{line.quantity}</span>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="+"
                    disabled={line.quantity >= Math.min(99, line.stock)}
                    onClick={() => update(line.variantId, { quantity: line.quantity + 1 })}
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
                <span className="ms-auto text-sm tabular-nums">{formatPrice(lineTotalCents)}</span>
              </div>

              <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  {t("counter.new.reduceAmount")}
                  <Input
                    inputMode="decimal"
                    aria-invalid={overCap || undefined}
                    value={line.reduceText}
                    onChange={(e) => {
                      clearError();
                      update(line.variantId, { reduceText: e.target.value });
                    }}
                  />
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  {t("counter.new.reduceReason")}
                  <Input
                    value={line.reduceReason}
                    maxLength={200}
                    aria-invalid={needsReason || undefined}
                    placeholder={t("counter.new.reduceReasonPlaceholder")}
                    onChange={(e) => {
                      clearError();
                      update(line.variantId, { reduceReason: e.target.value });
                    }}
                  />
                </label>
              </div>
              {overCap ? (
                <p className="text-xs text-destructive">
                  {t("counter.new.reduceTooMuch")} {formatPrice(cap)}
                </p>
              ) : needsReason ? (
                <p className="text-xs text-destructive">{t("counter.new.reduceNeedsReason")}</p>
              ) : (
                reduceCents > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t("counter.sale.was")} {formatPrice(line.unitPriceCents)}
                  </p>
                )
              )}
            </li>
          ))}
        </ul>

        {lines.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground">
              {role === "STAFF" ? t("counter.new.reduceCapStaff") : t("counter.new.reduceCapOwner")}
            </p>
            <Segmented
              label={t("counter.new.payment")}
              value={payment}
              onChange={setPayment}
              options={[
                { id: "CASH", label: t("counter.payment.CASH") },
                { id: "CARD", label: t("counter.payment.CARD") },
              ]}
            />
            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm text-muted-foreground">{t("counter.new.total")}</span>
              <span data-testid="till-total" className="text-2xl font-semibold tabular-nums">
                {formatPrice(total)}
              </span>
            </div>
          </>
        )}

        {errorKey && (
          <p role="alert" className="text-sm text-destructive">
            {t(errorKey as Parameters<typeof t>[0])}
            {errorNote ? ` ${errorNote}` : ""}
          </p>
        )}

        {lines.length > 0 && (
          <Button
            size="lg"
            data-testid="till-complete"
            onClick={complete}
            disabled={pending || blocked}
          >
            {pending ? t("counter.new.recording") : t("counter.new.record")}
          </Button>
        )}
      </section>
    </div>
  );
}

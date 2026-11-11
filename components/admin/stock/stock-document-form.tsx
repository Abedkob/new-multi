"use client";

import { useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Field } from "@/components/field";
import { SectionCard } from "@/components/admin/section-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/context";
import {
  MAX_STOCK_LINES,
  countedCeiling,
  parseStockCostCents,
  parseStockWhole,
} from "@/lib/stock";
import { MAX_STOCK } from "@/lib/variants";
import { cn } from "@/lib/utils";
import { VariantPicker } from "./variant-picker";
import {
  countStockAction,
  receiveStockAction,
  type StockPickerItem,
} from "@/app/admin/(panel)/stock/actions";

/**
 * One form behind both documents: a delivery received, and a shelf counted.
 *
 * They differ in exactly three places — what the number in each row means, whether the unit cost
 * column exists, and whether submitting needs confirming — and in nothing else: the same picker,
 * the same line list, the same reference and note, the same summary. Two components would have
 * been two copies of the parts that are the same, which is how the orders and till status filters
 * ended up as two controls that behaved identically and looked different.
 *
 * Three rules carried over from the till, each of which it learned the hard way:
 *
 *  1. **Every number is held as the text that was typed**, and parsed on read. A controlled numeric
 *     field that re-formats on each keystroke cannot be typed into.
 *  2. **The submission id is minted once per document** and replaced only after one is recorded. A
 *     double tap, or a retry after the network dropped on a request that actually committed, is
 *     answered with the same document rather than writing a second one.
 *  3. **Every rule the server enforces is checked here too**, so a refusal never arrives after
 *     somebody has walked a shelf.
 *
 * The one thing it does NOT do is tell a counter what to count. The "expected" figure is shown
 * because it is useful, but the server recomputes the variance from what it finds under a row lock
 * (D94) — so if the shelf moved while somebody walked it, the summary reports what was really
 * applied rather than the difference this screen predicted.
 */

type Kind = "RECEIPT" | "COUNT";

type Line = {
  variantId: string;
  productName: string;
  variantLabel: string;
  /** What the server said was on the shelf when this line was added. Not authoritative. */
  shelf: number;
  /** Received quantity, or counted figure. As typed. */
  numberText: string;
  /** Unit cost in whole currency units, as typed. Owner only. */
  costText: string;
};

function newSubmissionId() {
  // crypto.randomUUID needs a secure context, and this project has already shipped a bug that
  // assumed one off localhost.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      /* fall through */
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function StockDocumentForm({ kind, withCost }: { kind: Kind; withCost: boolean }) {
  const t = useT();
  const receiving = kind === "RECEIPT";
  const [lines, setLines] = useState<Line[]>([]);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [submissionId, setSubmissionId] = useState(newSubmissionId);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [done, setDone] = useState<{
    batchId: string;
    idempotent: boolean;
    /** How many lines the server recorded, and how many of them actually moved a figure. */
    applied: number;
    changed: number;
    /** True when the shelf had moved since this screen read it — see the summary's wording. */
    stale: boolean;
  } | null>(null);

  /** Each line with its number resolved and judged. The document's one source of truth. */
  const judged = lines.map((line) => {
    const value = parseStockWhole(line.numberText);
    // Shape and ceiling are separate verdicts, because they need separate sentences. Conflating
    // them is how a stocktake of a 1,999,998 shelf came to show "agrees" and "Enter a whole
    // number, 0 or more" at the same time: the form pre-fills the shelf figure, then called its
    // own pre-fill malformed. A count may always name what is on the shelf (`countedCeiling`); a
    // receipt is measured against the ceiling the shelf would reach.
    const badNumber = value === null || (receiving && value < 1);
    const ceiling = receiving ? MAX_STOCK - line.shelf : countedCeiling(line.shelf);
    const overCeiling = value !== null && value > ceiling;
    const cost = parseStockCostCents(line.costText);
    const badCost = line.costText.trim() !== "" && cost === null;
    return {
      line,
      value: value ?? 0,
      badNumber,
      overCeiling,
      ceiling,
      cost,
      badCost,
      /** Receiving: where the shelf ends up. Counting: the variance against what we were shown. */
      after: receiving ? line.shelf + (value ?? 0) : (value ?? 0),
      delta: receiving ? (value ?? 0) : (value ?? 0) - line.shelf,
    };
  });

  const blocked =
    lines.length === 0 ||
    judged.some((j) => j.badNumber || j.overCeiling || j.badCost) ||
    pending;
  const full = lines.length >= MAX_STOCK_LINES;
  const variances = judged.filter((j) => j.delta !== 0);

  function clearError() {
    setErrorKey(null);
  }

  function add(item: StockPickerItem) {
    clearError();
    setLines((current) => {
      const existing = current.find((l) => l.variantId === item.variantId);
      if (existing) {
        // A delivery that arrived in two boxes is one line with a bigger quantity — the same
        // merge the server does, so the screen agrees with what gets recorded. A second count of
        // one shelf is the same shelf, so its figure is left alone.
        if (!receiving) return current;
        return current.map((l) =>
          l.variantId === item.variantId
            ? { ...l, numberText: String((parseStockWhole(l.numberText) ?? 0) + 1) }
            : l,
        );
      }
      if (current.length >= MAX_STOCK_LINES) return current;
      return [
        ...current,
        {
          variantId: item.variantId,
          productName: item.productName,
          variantLabel: item.variantLabel,
          shelf: item.stock,
          // Receiving starts at one box; counting starts at what is believed to be there, so a
          // shelf that agrees needs no typing at all — and still gets its zero-delta row.
          numberText: receiving ? "1" : String(item.stock),
          costText: "",
        },
      ];
    });
  }

  function update(variantId: string, patch: Partial<Line>) {
    clearError();
    setLines((current) =>
      current.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l)),
    );
  }

  async function submit() {
    if (blocked) return;
    setPending(true);
    clearError();
    const result = receiving
      ? await receiveStockAction({
          submissionId,
          reference,
          note,
          lines: judged.map((j) => ({
            variantId: j.line.variantId,
            quantity: j.value,
            unitCostCents: withCost ? j.cost : null,
          })),
        })
      : await countStockAction({
          submissionId,
          reference,
          note,
          lines: judged.map((j) => ({ variantId: j.line.variantId, counted: j.value })),
        });
    setPending(false);

    if (!result.ok) {
      setErrorKey(result.errorKey);
      return;
    }
    if (result.ok && "applied" in result) {
      // What the server actually replaced, which is the only honest summary: the "expected" figure
      // on screen may have been stale, and reporting the variance somebody was shown would be
      // reporting a discrepancy that was never there.
      const shown = new Map(lines.map((l) => [l.variantId, l.shelf]));
      const stale = result.applied.some((row) => shown.get(row.variantId) !== row.from);
      const changed = result.applied.filter((row) => row.delta !== 0).length;
      setDone({
        batchId: result.batchId,
        idempotent: result.idempotent,
        applied: result.applied.length,
        changed,
        stale,
      });
    } else {
      setDone({
        batchId: result.batchId,
        idempotent: result.idempotent,
        applied: result.lines,
        changed: result.lines,
        stale: false,
      });
    }
  }

  function startAnother() {
    setLines([]);
    setReference("");
    setNote("");
    // A new document is a new submission. Until this point a retry is the SAME document.
    setSubmissionId(newSubmissionId());
    setDone(null);
    clearError();
  }

  if (done) {
    return (
      <SectionCard
        data-testid="stock-document-done"
        title={receiving ? t("stock.done.received") : t("stock.done.counted")}
      >
        <div className="grid gap-3">
          <p className="text-sm">
            {receiving
              ? `${done.applied} ${t("stock.done.linesReceived")}`
              : `${done.applied} ${t("stock.done.linesCounted")} · ${done.changed} ${t("stock.done.linesChanged")}`}
          </p>
          {done.idempotent && (
            <p className="text-sm text-muted-foreground">{t("stock.done.alreadyRecorded")}</p>
          )}
          {done.stale && (
            <p className="text-sm text-muted-foreground">{t("stock.done.shelfMoved")}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={startAnother}>
              {receiving ? t("stock.done.receiveAnother") : t("stock.done.countAnother")}
            </Button>
            <Link
              href={`/admin/stock/history?batch=${done.batchId}`}
              className={buttonVariants({ variant: "outline" })}
            >
              {t("stock.done.viewDocument")}
            </Link>
          </div>
        </div>
      </SectionCard>
    );
  }

  return (
    <div className="grid gap-4">
      <SectionCard title={t("stock.picker.heading")} description={t("stock.picker.hint")}>
        <VariantPicker onPick={add} disabled={full} />
        {full && (
          <p className="mt-2 text-sm text-muted-foreground">
            {t("stock.form.full")} {MAX_STOCK_LINES}
          </p>
        )}
      </SectionCard>

      <SectionCard
        title={
          <>
            {receiving ? t("stock.form.linesReceiving") : t("stock.form.linesCounting")}
            {lines.length > 0 && (
              <span className="ms-1 font-normal tabular-nums text-muted-foreground">
                ({lines.length})
              </span>
            )}
          </>
        }
      >
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("stock.form.noLines")}</p>
        ) : (
          <ul className="grid gap-3">
            {judged.map(({ line, badNumber, overCeiling, ceiling, badCost, after, delta }) => (
              <li
                key={line.variantId}
                data-testid="stock-line"
                className="grid gap-2 rounded-md border bg-background p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-sm font-medium">
                    {line.productName}
                    {line.variantLabel ? ` · ${line.variantLabel}` : ""}
                  </p>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("stock.form.removeLine")}
                    onClick={() =>
                      setLines((current) =>
                        current.filter((l) => l.variantId !== line.variantId),
                      )
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>

                <div
                  className={cn(
                    "grid gap-2",
                    withCost && receiving
                      ? "sm:grid-cols-[8rem_8rem_minmax(0,1fr)]"
                      : "sm:grid-cols-[8rem_minmax(0,1fr)]",
                  )}
                >
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    {receiving ? t("stock.form.quantity") : t("stock.form.counted")}
                    <Input
                      inputMode="numeric"
                      dir="ltr"
                      className="tabular-nums"
                      aria-invalid={badNumber || overCeiling || undefined}
                      aria-label={`${line.productName} ${
                        receiving ? t("stock.form.quantity") : t("stock.form.counted")
                      }`}
                      value={line.numberText}
                      onChange={(e) => update(line.variantId, { numberText: e.target.value })}
                    />
                  </label>
                  {withCost && receiving && (
                    <label className="grid gap-1 text-xs text-muted-foreground">
                      {t("stock.form.unitCost")}
                      <Input
                        inputMode="decimal"
                        dir="ltr"
                        className="tabular-nums"
                        aria-invalid={badCost || undefined}
                        aria-label={`${line.productName} ${t("stock.form.unitCost")}`}
                        value={line.costText}
                        onChange={(e) => update(line.variantId, { costText: e.target.value })}
                      />
                    </label>
                  )}
                  <p className="self-end text-xs text-muted-foreground">
                    {receiving ? (
                      <>
                        {t("stock.form.onShelf")} {line.shelf} → <strong>{after}</strong>
                      </>
                    ) : (
                      <>
                        {t("stock.form.expected")} {line.shelf}
                        {" · "}
                        {delta === 0 ? (
                          t("stock.form.agrees")
                        ) : (
                          <strong>
                            {delta > 0 ? "+" : ""}
                            {delta}
                          </strong>
                        )}
                      </>
                    )}
                  </p>
                </div>
                {badNumber && (
                  <p className="text-xs text-destructive">
                    {receiving ? t("stock.form.badQuantity") : t("stock.form.badCounted")}
                  </p>
                )}
                {!badNumber && overCeiling && (
                  <p className="text-xs text-destructive">
                    {receiving ? t("stock.form.receiptCeiling") : t("stock.form.countCeiling")}{" "}
                    <span className="tabular-nums">{ceiling}</span>
                  </p>
                )}
                {badCost && <p className="text-xs text-destructive">{t("stock.form.badCost")}</p>}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={t("stock.form.aboutTitle")} description={t("stock.form.aboutHint")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="reference"
            label={t("stock.form.reference")}
            optional={` · ${t("common.optional")}`}
            hint={receiving ? t("stock.form.referenceHintReceipt") : t("stock.form.referenceHintCount")}
            value={reference}
            maxLength={200}
            onChange={(e) => setReference(e.target.value)}
          />
          <Field
            name="note"
            label={t("stock.form.note")}
            optional={` · ${t("common.optional")}`}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </SectionCard>

      {errorKey && (
        <p role="alert" className="text-sm text-destructive">
          {t(errorKey as Parameters<typeof t>[0])}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          data-testid="stock-submit"
          disabled={blocked}
          // Receiving is additive and idempotent, so a dialog there would prevent nothing. A
          // stocktake overwrites figures nobody can recover, so it asks — and states the variance
          // it is about to apply, because "are you sure" with no numbers is not a question.
          onClick={() => (receiving ? submit() : setConfirming(true))}
        >
          {pending
            ? t("stock.form.submitting")
            : receiving
              ? t("stock.form.submitReceipt")
              : t("stock.form.submitCount")}
        </Button>
        <Link href="/admin/stock" className={buttonVariants({ variant: "outline" })}>
          {t("common.cancel")}
        </Link>
      </div>

      {!receiving && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t("stock.confirm.title")}
          confirmLabel={t("stock.confirm.apply")}
          cancelLabel={t("common.cancel")}
          description={
            variances.length === 0
              ? t("stock.confirm.noChanges")
              : `${t("stock.confirm.willChange")} ${variances
                  .map(
                    ({ line, delta }) =>
                      `${line.productName}${line.variantLabel ? ` (${line.variantLabel})` : ""} ${
                        delta > 0 ? "+" : ""
                      }${delta}`,
                  )
                  .join(", ")}`
          }
          onConfirm={() => {
            setConfirming(false);
            void submit();
          }}
        />
      )}
    </div>
  );
}

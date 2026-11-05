"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n/context";
import { setVariantStockAction } from "../../actions";

export type StockRow = { id: string; label: string; stock: number };

/**
 * One number per variant, saved one variant at a time.
 *
 * Deliberately not a single Save for the whole product: this screen exists so that stock can be
 * changed without the whole-product write, and a form that submitted every row together would be
 * one request that changes several things — the shape the narrow action was created to avoid.
 * Receiving stock happens a line at a time anyway.
 */
export function StockForm({ rows }: { rows: StockRow[] }) {
  const t = useT();
  return (
    <div className="grid gap-3" data-testid="stock-form">
      {rows.map((row) => (
        <StockField key={row.id} row={row} saveLabel={t("common.save")} />
      ))}
    </div>
  );
}

function StockField({ row, saveLabel }: { row: StockRow; saveLabel: string }) {
  const [value, setValue] = useState(String(row.stock));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const result = await setVariantStockAction(row.id, Number.parseInt(value, 10));
      if (result.error) setError(result.error);
      else setSaved(true);
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
      <div className="grid gap-1">
        <Label htmlFor={`stock-${row.id}`} className="text-xs">
          {row.label}
        </Label>
        <Input
          id={`stock-${row.id}`}
          name={`stock-${row.id}`}
          type="number"
          min={0}
          inputMode="numeric"
          className="w-28 tabular-nums"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
        />
      </div>
      <Button type="button" size="sm" onClick={save} disabled={pending}>
        {saveLabel}
      </Button>
      {saved && <span className="text-xs text-muted-foreground">✓</span>}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

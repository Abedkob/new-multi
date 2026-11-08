"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/context";

/**
 * Hands the receipt to the browser's own print dialog.
 *
 * No PDF, no receipt-printer protocol and no separate print route: a thermal printer at a counter
 * is installed as a system printer, so the one thing a cashier needs is this dialog with only the
 * receipt on the page. What gets printed is decided by the `@media print` block in globals.css,
 * which hides everything outside `[data-print-area]` — so the paper cannot pick up the sidebar,
 * the Void control or the back link.
 */
export function PrintButton() {
  const t = useT();
  return (
    <Button variant="outline" size="sm" onClick={() => window.print()}>
      <Printer className="size-4" />
      {t("counter.sale.print")}
    </Button>
  );
}

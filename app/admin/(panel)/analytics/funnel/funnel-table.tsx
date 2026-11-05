"use client";

import type { DictionaryKey } from "@/lib/i18n/dictionaries/en";
import { useT } from "@/lib/i18n/context";

const STEP_LABEL: Record<string, DictionaryKey> = {
  sessions: "funnel.step.sessions",
  productViewSessions: "funnel.step.productViewSessions",
  addToCartSessions: "funnel.step.addToCartSessions",
  cartViewSessions: "funnel.step.cartViewSessions",
  checkoutSessions: "funnel.step.checkoutSessions",
  orders: "funnel.step.orders",
  whatsappClickSessions: "funnel.step.whatsappClickSessions",
};

export type FunnelStepRow = {
  key: string;
  sessions: number;
  fromPreviousStep: number | null;
  fromEntry: number | null;
};

/**
 * One path's steps, as a table with a bar.
 *
 * Every step is a row, including a zero (P5-06). The drop-off column is the share of the step
 * above, and it is blank only at the top, where there is nothing to divide by — never "100%",
 * which would read as a step that lost nobody.
 */
export function FunnelPathTable({ steps }: { steps: FunnelStepRow[] }) {
  const t = useT();
  const entry = Math.max(1, steps[0]?.sessions ?? 1);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-muted-foreground">
          <th scope="col" className="py-1 text-start font-medium">
            {t("funnel.table.step")}
          </th>
          <th scope="col" className="py-1 text-end font-medium">
            {t("funnel.table.sessions")}
          </th>
          <th scope="col" className="py-1 text-end font-medium">
            {t("funnel.table.fromPrevious")}
          </th>
          <th scope="col" className="py-1 text-end font-medium">
            {t("funnel.table.fromEntry")}
          </th>
          <th scope="col" aria-hidden="true" className="w-1/3" />
        </tr>
      </thead>
      <tbody>
        {steps.map((step) => (
          <tr key={step.key} className="border-t" data-step={step.key}>
            <th scope="row" className="py-1.5 text-start font-normal">
              {STEP_LABEL[step.key] ? t(STEP_LABEL[step.key]) : step.key}
            </th>
            <td className="py-1.5 text-end tabular-nums">{step.sessions}</td>
            <td className="py-1.5 text-end tabular-nums">
              {step.fromPreviousStep === null ? "" : `${(step.fromPreviousStep * 100).toFixed(1)}%`}
            </td>
            <td className="py-1.5 text-end tabular-nums">
              {step.fromEntry === null ? "" : `${(step.fromEntry * 100).toFixed(1)}%`}
            </td>
            <td className="py-1.5 ps-3" aria-hidden="true">
              <div
                className="h-2 rounded-sm bg-primary/30"
                style={{ width: `${(step.sessions / entry) * 100}%` }}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

"use client";

import type { Insight } from "@/lib/analytics/insights";
import type { DictionaryKey } from "@/lib/i18n/dictionaries/en";
import { useT } from "@/lib/i18n/context";

/**
 * §6's insights, as a merchant reads them (P5-09, P5-10, P5-11).
 *
 * Three rules, all of them about what this list is NOT allowed to do:
 *
 *   1. **Every line carries its evidence.** The sentence under each insight is built from the
 *      same numbers that made it fire, so a merchant can disagree with it. An insight whose
 *      evidence is hidden behind a tooltip is a recommendation from nowhere.
 *   2. **No line asserts a cause** (P5-11). "Seen often, rarely bought" is a description;
 *      "your price is too high" is a guess about a shop this code has never seen. The copy
 *      states what was counted and stops.
 *   3. **Nothing qualifies is an answer** (P5-10). The empty state says there is not enough
 *      evidence yet — it never offers the next-weakest pattern instead, which is exactly what
 *      a merchant would act on and exactly what §6's thresholds exist to withhold.
 *
 * The copy is built from `kind` + `subject` + `numbers`, never from `insight.evidence`, which is
 * dev-facing English. That is why the leading measure is a structural field: a screen can look
 * up "views" in Arabic, and it cannot translate a sentence.
 */

const COPY: Record<Insight["kind"], { title: DictionaryKey; evidence: DictionaryKey }> = {
  "activity-shift": { title: "insight.activityShift", evidence: "insight.activityShift.evidence" },
  "funnel-drop": { title: "insight.funnelDrop", evidence: "insight.funnelDrop.evidence" },
  "unmet-search": { title: "insight.unmetSearch", evidence: "insight.unmetSearch.evidence" },
  "high-interest-low-conversion": {
    title: "insight.highInterest",
    evidence: "insight.highInterest.evidence",
  },
  "unnoticed-product": { title: "insight.unnoticed", evidence: "insight.unnoticed.evidence" },
  "strong-source": { title: "insight.strongSource", evidence: "insight.strongSource.evidence" },
  "revisited-product": { title: "insight.revisited", evidence: "insight.revisited.evidence" },
  "top-product": { title: "insight.topProduct", evidence: "insight.topProduct.evidence" },
};

const MEASURE_LABEL: Record<NonNullable<Insight["subject"]["measure"]>, DictionaryKey> = {
  purchasingSessions: "insight.measure.orders",
  whatsappClickSessions: "insight.measure.whatsapp",
  viewSessions: "insight.measure.views",
};

const STEP_LABEL: Record<string, DictionaryKey> = {
  sessions: "funnel.step.sessions",
  productViewSessions: "funnel.step.productViewSessions",
  addToCartSessions: "funnel.step.addToCartSessions",
  cartViewSessions: "funnel.step.cartViewSessions",
  checkoutSessions: "funnel.step.checkoutSessions",
  orders: "funnel.step.orders",
  whatsappClickSessions: "funnel.step.whatsappClickSessions",
};

const fill = (text: string, values: (string | number)[]) =>
  values.reduce((s: string, value, i) => s.replaceAll(`{${i}}`, String(value)), text);

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

export function InsightList({ insights }: { insights: Insight[] }) {
  const t = useT();

  if (insights.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        {t("insight.none")}
      </p>
    );
  }

  /** Everything each kind's copy interpolates, in the order its dictionary entry expects. */
  const params = (insight: Insight): (string | number)[] => {
    const n = insight.numbers;
    const product = insight.subject.productName ?? t("productsReport.deleted");
    switch (insight.kind) {
      case "activity-shift":
        return [n.current, n.previous, n.absolute];
      case "funnel-drop": {
        const step = STEP_LABEL[insight.subject.step ?? ""];
        return [step ? t(step) : (insight.subject.step ?? ""), pct(n.continuationRate), n.entered, n.continued];
      }
      case "unmet-search":
        return [insight.subject.phrase ?? "", n.noResultSearches, n.searches];
      case "high-interest-low-conversion":
        return [product, n.viewSessions, n.actions, pct(n.actionRate), pct(n.storeBaseline)];
      case "unnoticed-product":
        return [product, n.viewSessions, n.activeDays];
      case "strong-source":
        return [
          insight.subject.campaign
            ? `${insight.subject.source} / ${insight.subject.campaign}`
            : (insight.subject.source ?? ""),
          n.sessions,
          n.orders,
          n.whatsappClickSessions,
        ];
      case "revisited-product":
        return [product, n.returningViewerDays, n.viewerDays, pct(n.returningShare)];
      case "top-product":
        return [
          product,
          insight.subject.measure ? t(MEASURE_LABEL[insight.subject.measure]) : "",
          n.value,
          n.runnerUp,
        ];
    }
  };

  return (
    <ul className="grid gap-2">
      {insights.map((insight, i) => {
        const copy = COPY[insight.kind];
        const values = params(insight);
        return (
          <li
            key={`${insight.kind}-${i}`}
            data-insight={insight.kind}
            className="grid gap-1 rounded-md border p-3"
          >
            <span className="text-sm font-medium">
              {insight.tone === "attention" ? "⚠ " : ""}
              {fill(t(copy.title), values)}
            </span>
            {/* The evidence, always. Same numbers, said plainly. */}
            <span className="text-xs text-muted-foreground">
              {fill(t(copy.evidence), values)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

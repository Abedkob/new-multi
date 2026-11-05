import { notFound } from "next/navigation";
import { PeriodPicker } from "@/components/admin/period-picker";
import { rangeFromPeriod } from "@/lib/analytics/range";
import { funnelReport } from "@/lib/analytics/report";
import { getTenantById } from "@/lib/data/tenants";
import { formatPrice } from "@/lib/format";
import { getT } from "@/lib/i18n/locale";
import { requireCapability } from "@/lib/permissions";
import { FunnelPathTable } from "./funnel-table";

/**
 * Analytics -> Funnel (§5.4, P5-06).
 *
 * Two paths, side by side and never summed. A visitor is on neither path until they act, so the
 * paths share their first steps — but the website path ends in orders and the WhatsApp path ends
 * in clicks, and those are different things: one is money, the other is a conversation starting
 * somewhere this platform cannot see.
 *
 * Every step is rendered, zero included (P5-06/D46). A funnel that drops an empty step makes a
 * broken checkout look like a narrow one: the step that reads 0 of 40 IS the finding.
 */
export default async function FunnelReportPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { tenantId } = await requireCapability("analytics:read");
  const t = await getT();
  const tenant = await getTenantById(tenantId);
  if (!tenant) notFound();

  const { period } = await searchParams;
  const { range, period: current } = rangeFromPeriod(period, tenant.analyticsTimezone);
  const funnel = await funnelReport(tenantId, range);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("funnel.page.description")}</p>
        <PeriodPicker
          basePath="/admin/analytics/funnel"
          current={current}
          ariaLabel={t("results.period.label")}
        />
      </div>

      <section className="grid gap-2">
        <h2 className="text-sm font-semibold">{t("funnel.website.heading")}</h2>
        <FunnelPathTable
          steps={funnel.website.steps.map((step) => ({
            key: step.key,
            sessions: step.sessions,
            fromPreviousStep: step.fromPreviousStep,
            fromEntry: step.fromEntry,
          }))}
        />
        <p className="text-xs text-muted-foreground">
          {t("funnel.website.value")}: {formatPrice(funnel.websiteOrderValueCents)}
        </p>
      </section>

      <section className="grid gap-2">
        <h2 className="text-sm font-semibold">{t("funnel.whatsapp.heading")}</h2>
        <FunnelPathTable
          steps={funnel.whatsapp.steps.map((step) => ({
            key: step.key,
            sessions: step.sessions,
            fromPreviousStep: step.fromPreviousStep,
            fromEntry: step.fromEntry,
          }))}
        />
        {/* Separately named and separately formatted, so no reader can take one for the other. */}
        <p className="text-xs text-muted-foreground">
          {t("funnel.whatsapp.value")}: {formatPrice(funnel.whatsappPotentialValueCents)}
        </p>
        <p className="text-xs text-muted-foreground">{t("funnel.whatsapp.note")}</p>
      </section>
    </div>
  );
}

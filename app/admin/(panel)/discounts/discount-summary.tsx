import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/format";
import { getT } from "@/lib/i18n/locale";
import type { DictionaryKey } from "@/lib/i18n/dictionaries/en";
import { discountStatus, type DiscountCandidate } from "@/lib/pricing";

type SummaryDiscount = Pick<
  DiscountCandidate,
  "isEnabled" | "startsAt" | "endsAt" | "archivedAt"
>;

const STATUS_LABEL_KEYS = {
  ACTIVE: "discounts.status.ACTIVE",
  SCHEDULED: "discounts.status.SCHEDULED",
  ENDED: "discounts.status.ENDED",
  DISABLED: "discounts.status.DISABLED",
  ARCHIVED: "discounts.status.ARCHIVED",
} as const satisfies Record<string, DictionaryKey>;

function dateLabel(value: Date | string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export async function DiscountStatusBadge({ discount, at }: { discount: SummaryDiscount; at: Date }) {
  const t = await getT();
  const status = discountStatus(discount, at);
  const variant = status === "ACTIVE"
    ? "default"
    : status === "ENDED" || status === "ARCHIVED"
      ? "outline"
      : "secondary";
  return <Badge variant={variant}>{t(STATUS_LABEL_KEYS[status])}</Badge>;
}

export async function DiscountValueLabel({
  type,
  value,
}: {
  type: "PERCENTAGE" | "FIXED_AMOUNT";
  value: number;
}) {
  const t = await getT();
  return <>{type === "PERCENTAGE" ? `${value}% ${t("discounts.off")}` : `${formatPrice(value)} ${t("discounts.offEachUnit")}`}</>;
}

export async function DiscountScheduleLabel({
  startsAt,
  endsAt,
}: {
  startsAt: Date | string | null;
  endsAt: Date | string | null;
}) {
  const t = await getT();
  if (!startsAt && !endsAt) return <>{t("discounts.schedule.always")}</>;
  return (
    <>
      {dateLabel(startsAt) ?? t("discounts.schedule.immediately")}{" "}
      <span aria-hidden className="inline-block rtl:-scale-x-100">
        &rarr;
      </span>{" "}
      {dateLabel(endsAt) ?? t("discounts.schedule.noEnd")}
    </>
  );
}

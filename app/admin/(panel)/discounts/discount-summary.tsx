import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/format";
import { discountStatus, type DiscountCandidate } from "@/lib/pricing";

type SummaryDiscount = Pick<
  DiscountCandidate,
  "isEnabled" | "startsAt" | "endsAt" | "archivedAt"
>;

const STATUS_LABELS = {
  ACTIVE: "Active",
  SCHEDULED: "Scheduled",
  ENDED: "Ended",
  DISABLED: "Disabled",
  ARCHIVED: "Archived",
} as const;

function dateLabel(value: Date | string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function DiscountStatusBadge({ discount, at }: { discount: SummaryDiscount; at: Date }) {
  const status = discountStatus(discount, at);
  const variant = status === "ACTIVE"
    ? "default"
    : status === "ENDED" || status === "ARCHIVED"
      ? "outline"
      : "secondary";
  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>;
}

export function DiscountValueLabel({
  type,
  value,
}: {
  type: "PERCENTAGE" | "FIXED_AMOUNT";
  value: number;
}) {
  return <>{type === "PERCENTAGE" ? `${value}% off` : `${formatPrice(value)} off each unit`}</>;
}

export function DiscountScheduleLabel({
  startsAt,
  endsAt,
}: {
  startsAt: Date | string | null;
  endsAt: Date | string | null;
}) {
  if (!startsAt && !endsAt) return <>Always</>;
  return <>{dateLabel(startsAt) ?? "Immediately"} &rarr; {dateLabel(endsAt) ?? "No end"}</>;
}

export function DiscountPricePreview({
  regularPriceCents,
  discountedPriceCents,
}: {
  regularPriceCents: number;
  discountedPriceCents: number;
}) {
  return (
    <span className="flex items-baseline gap-2 tabular-nums">
      <span className="text-muted-foreground line-through">{formatPrice(regularPriceCents)}</span>
      <span className="font-semibold">{formatPrice(discountedPriceCents)}</span>
    </span>
  );
}

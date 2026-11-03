"use client";

import { useT } from "@/lib/i18n/context";

export function CouponScheduleLabel({ startsAt, endsAt }: { startsAt: string | null; endsAt: string | null }) {
  const t = useT();
  if (!startsAt && !endsAt) return <span>{t("discounts.schedule.always")}</span>;
  const format = (value: string | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : null;
  return <span>{format(startsAt) ?? t("discounts.schedule.immediately")} <span aria-hidden>→</span> {format(endsAt) ?? t("discounts.schedule.noEnd")}</span>;
}

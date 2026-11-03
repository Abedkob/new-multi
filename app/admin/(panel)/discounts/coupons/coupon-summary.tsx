import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/format";
import { getT } from "@/lib/i18n/locale";
import { couponStatus, type CouponCandidate } from "@/lib/pricing";

export async function CouponStatusBadge({ coupon, at }: { coupon: CouponCandidate; at: Date }) {
  const t = await getT();
  const status = couponStatus(coupon, at);
  const labels = { ACTIVE: "coupons.status.active", SCHEDULED: "coupons.status.scheduled", EXPIRED: "coupons.status.expired", DISABLED: "coupons.status.disabled", ARCHIVED: "coupons.status.archived" } as const;
  return <Badge variant={status === "ACTIVE" ? "default" : status === "EXPIRED" || status === "ARCHIVED" ? "outline" : "secondary"}>{t(labels[status])}</Badge>;
}

export async function CouponOfferLabel({ coupon, products }: { coupon: { scope: string; type: string | null; value: number | null }; products: number }) {
  const t = await getT();
  if (coupon.scope === "FREE_DELIVERY") return <>{t("coupons.offer.freeDelivery")}</>;
  const benefit = coupon.type === "PERCENTAGE" ? `${coupon.value}%` : formatPrice(coupon.value ?? 0);
  return <>{coupon.scope === "SELECTED_PRODUCTS" ? t("coupons.offer.selected").replace("{benefit}", benefit).replace("{count}", String(products)) : t("coupons.offer.order").replace("{benefit}", benefit)}</>;
}

export async function CouponAnnouncementState({ coupon, at }: { coupon: CouponCandidate & { isAnnounced: boolean }; at: Date }) {
  const t = await getT();
  if (!coupon.isAnnounced) return <span className="text-muted-foreground">{t("coupons.announcement.notPromoted")}</span>;
  const status = couponStatus(coupon, at);
  if (status === "ACTIVE") return <span>{t("coupons.announcement.showing")}</span>;
  if (status === "SCHEDULED") return <span>{t("coupons.announcement.scheduled")}</span>;
  return <span className="text-muted-foreground">{t("coupons.announcement.selectedInactive")}</span>;
}

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { getT } from "@/lib/i18n/locale";

export async function DiscountTypeNav({ current }: { current: "automatic" | "coupons" }) {
  const t = await getT();
  return (
    <nav aria-label={t("coupons.nav.aria")} className="flex w-fit rounded-lg border bg-muted/30 p-1">
      <Link href="/admin/discounts" aria-current={current === "automatic" ? "page" : undefined} className={buttonVariants({ variant: current === "automatic" ? "secondary" : "ghost", size: "sm" })}>
        {t("coupons.nav.automatic")}
      </Link>
      <Link href="/admin/discounts/coupons" aria-current={current === "coupons" ? "page" : undefined} className={buttonVariants({ variant: current === "coupons" ? "secondary" : "ghost", size: "sm" })}>
        {t("coupons.nav.codes")}
      </Link>
    </nav>
  );
}

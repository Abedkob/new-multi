import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { getT } from "@/lib/i18n/locale";
import { archiveDiscountAction, restoreDiscountAction } from "./actions";
import { ArchiveDiscountButton } from "./archive-button";

export async function DiscountCampaignActions({
  id,
  name,
  archived,
}: {
  id: string;
  name: string;
  archived: boolean;
}) {
  const t = await getT();
  if (archived) {
    return (
      <form action={restoreDiscountAction.bind(null, id)}>
        <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t("discounts.restore")}
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Link href={`/admin/discounts/${id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
        {t("common.edit")}
      </Link>
      <form action={archiveDiscountAction.bind(null, id)}>
        <ArchiveDiscountButton name={name} />
      </form>
    </div>
  );
}

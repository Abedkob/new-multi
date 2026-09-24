import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { archiveDiscountAction, restoreDiscountAction } from "./actions";
import { ArchiveDiscountButton } from "./archive-button";

export function DiscountCampaignActions({
  id,
  name,
  archived,
}: {
  id: string;
  name: string;
  archived: boolean;
}) {
  if (archived) {
    return (
      <form action={restoreDiscountAction.bind(null, id)}>
        <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Restore
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Link href={`/admin/discounts/${id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
        Edit
      </Link>
      <form action={archiveDiscountAction.bind(null, id)}>
        <ArchiveDiscountButton name={name} />
      </form>
    </div>
  );
}

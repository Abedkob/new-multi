"use server";

import { revalidatePath } from "next/cache";
import {
  CampaignError,
  campaignNameError,
  saveCampaign,
  setCampaignArchived,
} from "@/lib/data/campaigns";
import { requireOwner } from "@/lib/session";
import { saveCampaignSchema } from "@/lib/validation";

/**
 * Saving and archiving a campaign (D39).
 *
 * The tenant comes from `requireOwner`, never from the caller — `saveCampaignAction` is handed
 * to the link builder as a prop, so its argument is whatever a browser chose to send. The store
 * it writes to is not part of that argument.
 *
 * Not audited, unlike the integration writes next door. The difference is what a mistake costs:
 * an integration id changes what every visitor's browser is told to do, while this is a label
 * the owner gave their own link. It holds no numbers, affects no report and no storefront, and
 * the only person who can write it is the only person who can read it.
 */
export async function saveCampaignAction(input: {
  name: string;
  utmCampaign: string;
  channel: string;
  destinationPath: string;
}): Promise<{ error?: string }> {
  const owner = await requireOwner();
  const parsed = saveCampaignSchema.safeParse(input);
  if (!parsed.success) {
    // The first message, not the whole tree: the builder has one line to show it in, and the
    // fields it came from are the ones already on screen.
    return { error: parsed.error.issues[0]?.message ?? "That campaign could not be saved." };
  }

  try {
    await saveCampaign(owner.tenantId, parsed.data);
  } catch (error) {
    try {
      campaignNameError(error);
    } catch (translated) {
      if (translated instanceof CampaignError) return { error: translated.message };
      throw translated;
    }
  }

  revalidatePath("/admin/marketing/campaigns");
  return {};
}

export async function setCampaignArchivedAction(id: string, archived: boolean) {
  const owner = await requireOwner();
  try {
    await setCampaignArchived(owner.tenantId, id, archived);
  } catch (error) {
    if (error instanceof CampaignError) return { error: error.message };
    throw error;
  }
  revalidatePath("/admin/marketing/campaigns");
  return {};
}

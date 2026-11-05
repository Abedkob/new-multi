/**
 * Campaigns an owner saved while building a tracked link (D39).
 *
 * Two rules hold this area together:
 *
 *   1. **Reports read the data, never this table.** A campaign is a `utm_campaign` value that
 *      came back from a real visit, so Results shows campaigns an owner never saved, and keeps
 *      showing one they archived. `campaignResults` in lib/analytics/report.ts is the only
 *      source of numbers anywhere.
 *   2. **This table holds no numbers.** It cannot drift from a report because there is nothing
 *      in it to drift.
 *
 * The merge of the two — saved rows plus observed numbers — lives here rather than in
 * report.ts, because report.ts is held to reading aggregate tables only (verify:reports walks
 * its imports). A report that could read `MarketingCampaign` would be a report whose figures
 * depend on an owner's bookkeeping, which is the thing D39 is written to prevent.
 */

import { Prisma } from "@/generated/prisma/client";
import type { DayRange } from "@/lib/analytics/compare";
import { campaignResults, type AcquisitionRow, type AttributionBasis } from "@/lib/analytics/report";
import { withTenant } from "@/lib/prisma";

export type SavedCampaign = {
  id: string;
  name: string;
  utmCampaign: string;
  channel: string;
  destinationPath: string;
  createdAt: Date;
  archivedAt: Date | null;
};

export type CampaignInput = {
  name: string;
  utmCampaign: string;
  channel: string;
  destinationPath: string;
};

/**
 * One line in the Campaigns tab: what the owner saved (if anything), and what the data says
 * (if anything). Exactly one of the two may be missing, and which one tells the owner something
 * different, so neither is faked:
 *
 *   - `saved` and no traffic yet -> zeros. This is P5-13: the link you just built is listed the
 *     moment you save it, reading "nothing yet" rather than not being there at all.
 *   - traffic and no `saved` row -> the campaign still appears (P5-14). Someone tagged a link by
 *     hand, or saved it and archived it later; the visits happened either way.
 */
export type CampaignLine = {
  /** The join key, and the only thing the two halves have in common. */
  utmCampaign: string;
  /** What to call it: the owner's name when they saved one, else the utm value itself. */
  label: string;
  saved: SavedCampaign | null;
  /** Null when the range holds no visit for this campaign at all. */
  observed: AcquisitionRow | null;
};

const SELECT = {
  id: true,
  name: true,
  utmCampaign: true,
  channel: true,
  destinationPath: true,
  createdAt: true,
  archivedAt: true,
} as const;

export function listSavedCampaigns(
  tenantId: string,
  includeArchived = false,
): Promise<SavedCampaign[]> {
  return withTenant(tenantId, (db) =>
    db.marketingCampaign.findMany({
      where: { tenantId, ...(includeArchived ? {} : { archivedAt: null }) },
      select: SELECT,
      orderBy: { createdAt: "desc" },
    }),
  );
}

export class CampaignError extends Error {
  constructor(message: string, public readonly code: string = message) {
    super(message);
  }
}

/**
 * Save (or re-save) a campaign.
 *
 * An upsert on the utm value rather than an insert, because saving the same campaign twice is
 * what an owner does: they build the Instagram link on Monday and the WhatsApp one on Tuesday
 * under the same campaign name. The second save updates the name and brings an archived row
 * back, which is what "save this campaign" plainly means — and never creates a second row for
 * one utm value, which would double the campaign in the list while the data stayed single.
 */
export function saveCampaign(tenantId: string, input: CampaignInput): Promise<SavedCampaign> {
  return withTenant(tenantId, (db) =>
    db.marketingCampaign.upsert({
      where: { tenantId_utmCampaign: { tenantId, utmCampaign: input.utmCampaign } },
      create: { tenantId, ...input },
      update: {
        name: input.name,
        channel: input.channel,
        destinationPath: input.destinationPath,
        archivedAt: null,
      },
      select: SELECT,
    }),
  );
}

/**
 * Archive or restore. Never delete: the campaign's visits and orders are in the data forever,
 * so a row removed here would leave Results showing a campaign the owner cannot name. Archiving
 * takes it out of the owner's list and changes no number anywhere.
 */
export async function setCampaignArchived(tenantId: string, id: string, archived: boolean) {
  const changed = await withTenant(tenantId, (db) =>
    db.marketingCampaign.updateMany({
      where: { tenantId, id },
      data: { archivedAt: archived ? new Date() : null },
    }),
  );
  if (changed.count === 0) {
    throw new CampaignError("That campaign no longer exists.", "campaigns.error.missing");
  }
}

export function campaignNameError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new CampaignError("That campaign is already saved.", "campaigns.error.duplicate");
  }
  throw error;
}

/**
 * The Campaigns tab's rows: every saved campaign, plus every campaign the range actually saw.
 *
 * Sorted by sessions and then by recency, so a campaign with traffic outranks one with none and
 * a brand-new save still appears at the top of the rest rather than below an old dormant one.
 */
export async function listCampaignLines(
  tenantId: string,
  range: DayRange,
  basis: AttributionBasis = "last",
  includeArchived = false,
): Promise<CampaignLine[]> {
  const [saved, observed] = await Promise.all([
    listSavedCampaigns(tenantId, includeArchived),
    campaignResults(tenantId, range, basis),
  ]);

  const lines = new Map<string, CampaignLine>();
  for (const row of saved) {
    lines.set(row.utmCampaign, {
      utmCampaign: row.utmCampaign,
      label: row.name,
      saved: row,
      observed: null,
    });
  }
  for (const row of observed) {
    const existing = lines.get(row.campaign);
    if (existing) {
      existing.observed = row;
      continue;
    }
    // Observed but not saved, or saved and archived: it happened, so it is listed (P5-14).
    lines.set(row.campaign, {
      utmCampaign: row.campaign,
      label: row.campaign,
      saved: null,
      observed: row,
    });
  }

  return [...lines.values()].sort((a, b) => {
    const bySessions = (b.observed?.sessions ?? 0) - (a.observed?.sessions ?? 0);
    if (bySessions !== 0) return bySessions;
    return (b.saved?.createdAt.getTime() ?? 0) - (a.saved?.createdAt.getTime() ?? 0);
  });
}

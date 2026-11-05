"use client";

import { useState, useTransition } from "react";
import { setCampaignArchivedAction } from "./actions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPrice } from "@/lib/format";
import { useT } from "@/lib/i18n/context";

export type CampaignTableLine = {
  utmCampaign: string;
  label: string;
  /** Null when this campaign was never saved — it exists only in the data (P5-14). */
  savedId: string | null;
  channel: string | null;
  archived: boolean;
  /** Null when the range saw no visit for it at all. Rendered as 0, not as "—" (P5-13). */
  sessions: number | null;
  orders: number | null;
  orderValueCents: number | null;
};

/**
 * The Campaigns list.
 *
 * A saved campaign with no traffic reads "0", not "—" and not a blank row: zero sessions is a
 * fact about a campaign nobody has clicked yet, and it is the honest answer an hour after the
 * link went out. "—" would suggest the number is unknown, which is a different thing and the
 * one this screen must not say (P5-13).
 */
export function CampaignTable({ lines }: { lines: CampaignTableLine[] }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (lines.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        {t("campaigns.empty")}
      </p>
    );
  }

  const toggle = (id: string, archived: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = await setCampaignArchivedAction(id, archived);
      if (result?.error) setError(result.error);
    });

  return (
    <div className="grid gap-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("campaigns.table.campaign")}</TableHead>
            <TableHead className="text-right">{t("campaigns.table.sessions")}</TableHead>
            <TableHead className="text-right">{t("campaigns.table.orders")}</TableHead>
            <TableHead className="text-right">{t("campaigns.table.revenue")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.utmCampaign} data-campaign={line.utmCampaign}>
              <TableCell>
                <div className="grid gap-0.5">
                  <span className="font-medium">{line.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {/* The utm value, because this is what the owner has to put in the link for
                        the numbers to land on this row. */}
                    <code>utm_campaign={line.utmCampaign}</code>
                    {line.channel ? ` · ${line.channel}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {line.savedId
                      ? line.archived
                        ? t("campaigns.badge.archived")
                        : t("campaigns.badge.saved")
                      : t("campaigns.badge.observed")}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{line.sessions ?? 0}</TableCell>
              <TableCell className="text-right tabular-nums">{line.orders ?? 0}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatPrice(line.orderValueCents ?? 0)}
              </TableCell>
              <TableCell className="text-right">
                {line.savedId ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => toggle(line.savedId!, !line.archived)}
                    className="text-sm underline underline-offset-4 disabled:opacity-60"
                  >
                    {line.archived ? t("campaigns.action.restore") : t("campaigns.action.archive")}
                  </button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {error ? (
        <p role="status" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("campaigns.table.note")}</p>
    </div>
  );
}

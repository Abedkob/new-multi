"use client";

/**
 * The platform admin's console for a shopper's privacy request (§4.7, D36).
 *
 * Deliberately a three-step shape — look, export, erase — rather than one button. Erasure is
 * irreversible and is being done on behalf of somebody who is not in the room, so the admin
 * should be able to see what it would touch, hand the person a copy, and only then delete. The
 * confirmation field is a second copy of the id for the same reason.
 *
 * What it never shows: a name, a phone number, an address. The summary is counts and coarse
 * dimensions, because an admin resolving a request needs to know HOW MUCH there is, not what
 * somebody browsed.
 */

import { useActionState, useState } from "react";
import { Field, FormError } from "@/components/field";
import { SubmitButton } from "@/components/submit-button";
import {
  erasePrivacyRequestAction,
  exportPrivacyRequestAction,
  summarizePrivacyRequestAction,
  type PrivacyRequestState,
} from "./privacy-request-actions";

type AuditEntry = {
  id: string;
  at: Date;
  action: string;
  actorEmail: string;
  subject: string | null;
  detail: string | null;
};

export function PrivacyRequestControl({
  slug,
  audit,
}: {
  slug: string;
  audit: AuditEntry[];
}) {
  const [lookupState, lookup] = useActionState<PrivacyRequestState, FormData>(
    summarizePrivacyRequestAction.bind(null, slug),
    {},
  );
  const [exportState, exportIt] = useActionState<PrivacyRequestState, FormData>(
    exportPrivacyRequestAction.bind(null, slug),
    {},
  );
  const [eraseState, erase] = useActionState<PrivacyRequestState, FormData>(
    erasePrivacyRequestAction.bind(null, slug),
    {},
  );
  const [showErase, setShowErase] = useState(false);

  const summary = exportState.summary ?? lookupState.summary;
  const utc = (value: Date | string) =>
    `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value))} UTC`;

  return (
    <div className="grid gap-5" data-testid="privacy-request-control">
      <form action={lookup} className="grid max-w-xl gap-3">
        <Field
          label="Measurement id from the request"
          name="visitorId"
          required
          hint="The shopper finds this on the store's privacy page, under “Your measurement id”. It is not their consent reference, which identifies a decision rather than any stored data."
        />
        <div>
          <SubmitButton>Look up</SubmitButton>
        </div>
        <FormError message={lookupState.error} />
      </form>

      {summary?.found ? (
        <div className="grid gap-3 rounded-md border border-border p-4" data-testid="privacy-request-summary">
          <dl className="grid gap-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">First seen</dt>
              <dd>{summary.firstSeenAt ? utc(summary.firstSeenAt) : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last seen</dt>
              <dd>{summary.lastSeenAt ? utc(summary.lastSeenAt) : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Sessions / events</dt>
              <dd>
                {summary.sessions} / {summary.events}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Country / device</dt>
              <dd>
                {summary.country ?? "—"} / {summary.deviceClass ?? "—"}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Orders linked to this id</dt>
              <dd>
                {summary.linkedOrders} — these are <strong>kept</strong>. Erasing clears the link
                and leaves the order, its value and its non-identifying details untouched.
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2">
            <form action={exportIt}>
              <input type="hidden" name="visitorId" value={summary.visitorId} />
              <SubmitButton>Export a copy</SubmitButton>
            </form>
            <button
              type="button"
              onClick={() => setShowErase((open) => !open)}
              className="rounded-md border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/5"
            >
              {showErase ? "Cancel erasure" : "Erase this visitor's data"}
            </button>
          </div>
        </div>
      ) : null}

      {exportState.exported ? (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">
            Everything this store measured about that browser. Orders are listed by id only:
            they are the merchant&apos;s commercial record and are kept.
          </p>
          <textarea
            readOnly
            rows={14}
            value={exportState.exported}
            data-testid="privacy-request-export"
            className="w-full rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
          />
        </div>
      ) : null}

      {showErase && summary?.found ? (
        <form action={erase} className="grid max-w-xl gap-3 rounded-md border border-destructive/40 p-4">
          <p className="text-sm">
            This deletes {summary.events} event(s) and {summary.sessions} session(s) and cannot be
            undone. {summary.linkedOrders} order(s) will be detached and kept. Daily totals do not
            change — they are anonymous, and §4.7 says to preserve them.
          </p>
          <input type="hidden" name="visitorId" value={summary.visitorId} />
          <Field
            label="Type the measurement id again to confirm"
            name="confirmVisitorId"
            required
            errors={undefined}
          />
          <div>
            <SubmitButton>Erase permanently</SubmitButton>
          </div>
          <FormError message={eraseState.error} />
        </form>
      ) : null}

      {eraseState.erased ? (
        <p className="rounded-md border border-border bg-muted/30 p-3 text-sm" data-testid="privacy-request-erased">
          {eraseState.erased}
        </p>
      ) : null}

      <div className="grid gap-2">
        <h3 className="text-sm font-semibold">Recent privacy actions on this store</h3>
        {audit.length === 0 ? (
          <p className="text-sm text-muted-foreground">None recorded yet.</p>
        ) : (
          <ul className="grid gap-1 text-xs text-muted-foreground" data-testid="privacy-request-audit">
            {audit.map((entry) => (
              <li key={entry.id}>
                <span className="font-mono">{utc(entry.at)}</span> — {entry.action} by{" "}
                {entry.actorEmail}
                {entry.subject ? ` on ${entry.subject}` : ""}
                {entry.detail ? ` (${entry.detail})` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

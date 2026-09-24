"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Field, FormError } from "@/components/field";
import { SubmitButton } from "@/components/submit-button";
import type { FormState } from "@/lib/validation";
import { activateStoreLicenseAction } from "./actions";

type LicenseSummary = {
  status: string;
  productCode: string;
  keyHint: string | null;
  licenseType: string | null;
  expiresAt: Date | null;
  checkAfter: Date | null;
  offlineGraceUntil: Date | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
} | null;

function dateLabel(value: Date | null) {
  return value
    ? `${new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(value)} UTC`
    : "Not provided";
}

export function StoreLicenseControl({
  slug,
  license,
}: {
  slug: string;
  license: LicenseSummary;
}) {
  const [state, action] = useActionState<FormState, FormData>(
    activateStoreLicenseAction.bind(null, slug),
    {},
  );
  const active = license?.status === "LICENSE_ACTIVE";

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={active ? "secondary" : license ? "destructive" : "outline"}>
          {license?.status ?? "No license"}
        </Badge>
        {license?.licenseType && <span className="text-sm text-muted-foreground">{license.licenseType}</span>}
      </div>
      {license && (
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Product</dt><dd>{license.productCode}</dd></div>
          <div><dt className="text-muted-foreground">Key</dt><dd>{license.keyHint ? `Ending ${license.keyHint}` : "Stored encrypted"}</dd></div>
          <div><dt className="text-muted-foreground">Expires</dt><dd>{dateLabel(license.expiresAt)}</dd></div>
          <div><dt className="text-muted-foreground">Next provider check</dt><dd>{dateLabel(license.checkAfter)}</dd></div>
          <div><dt className="text-muted-foreground">Offline grace through</dt><dd>{dateLabel(license.offlineGraceUntil)}</dd></div>
          <div><dt className="text-muted-foreground">Last checked</dt><dd>{dateLabel(license.lastCheckedAt)}</dd></div>
          {license.lastError && (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Last provider status</dt><dd>{license.lastError}</dd>
            </div>
          )}
        </dl>
      )}

      <form action={action} className="grid max-w-lg gap-4">
        <Field
          label={license ? "Replace or reactivate license key" : "License key"}
          name="licenseKey"
          type="password"
          autoComplete="off"
          required
          maxLength={500}
          hint="The key is sent to the provider from the server and stored encrypted. It is never shown again."
          errors={state.fieldErrors?.licenseKey}
        />
        <FormError message={state.error} />
        {state.ok && <p className="text-sm text-muted-foreground">License activated.</p>}
        <div><SubmitButton pendingText="Checking license...">Activate license</SubmitButton></div>
      </form>
    </div>
  );
}

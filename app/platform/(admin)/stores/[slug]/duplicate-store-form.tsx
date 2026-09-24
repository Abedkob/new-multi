"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { duplicateStoreAction, type DuplicateStoreState } from "./actions";
import { Field, FormError } from "@/components/field";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";

function CopyButton({ getText, children }: { getText: () => string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(getText());
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "Copied!" : children}
    </Button>
  );
}

/** Copies content, categories, products and the template/theme into a brand-new store with its
 * own owner. Orders, the domain, license and marketing integration ids never carry over. */
export function DuplicateStoreForm({ slug, storeName }: { slug: string; storeName: string }) {
  const [state, action] = useActionState<DuplicateStoreState, FormData>(
    duplicateStoreAction.bind(null, slug),
    {},
  );

  if (state.credentials) {
    const { storeName: newName, slug: newSlug, ownerEmail, tempPassword } = state.credentials;
    return (
      <div className="grid gap-4 text-sm">
        <p className="text-muted-foreground">
          &ldquo;{newName}&rdquo; is ready. Copy these credentials now — the password is stored
          only as a hash and cannot be shown again once you leave this screen.
        </p>
        <dl className="grid gap-3">
          <div>
            <dt className="text-muted-foreground">Store URL</dt>
            <dd>
              <Link href={`/store/${newSlug}`} target="_blank" className="font-mono underline underline-offset-4">
                /store/{newSlug}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Owner email</dt>
            <dd className="font-mono">{ownerEmail}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Temporary password</dt>
            <dd data-testid="temp-password" className="font-mono text-base select-all">
              {tempPassword}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <CopyButton getText={() => tempPassword}>Copy password</CopyButton>
          <Link href={`/platform/stores/${newSlug}`} className="text-sm font-medium underline underline-offset-4">
            Manage the new store →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="grid max-w-md gap-4">
      <Field
        label="New store name"
        name="storeName"
        required
        defaultValue={`${storeName} (Copy)`}
        errors={state.fieldErrors?.storeName}
      />
      <Field
        label="New owner name"
        name="ownerName"
        required
        errors={state.fieldErrors?.ownerName}
      />
      <Field
        label="New owner email"
        name="ownerEmail"
        type="email"
        required
        hint="Must be different from every existing account — duplicating doesn't reuse this store's owner."
        errors={state.fieldErrors?.ownerEmail}
      />
      <FormError message={state.error} />
      <div>
        <SubmitButton pendingText="Duplicating...">Duplicate store</SubmitButton>
      </div>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createStoreAction, type CreateStoreState } from "./actions";
import { Field, FormError } from "@/components/field";
import { SubmitButton } from "@/components/submit-button";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function CreateStoreForm() {
  const [state, action] = useActionState<CreateStoreState, FormData>(
    createStoreAction,
    {},
  );

  if (state.credentials) return <Credentials {...state.credentials} />;

  return (
    <form action={action} className="grid max-w-md gap-4">
      <Field
        label="Store name"
        name="storeName"
        required
        errors={state.fieldErrors?.storeName}
      />
      <Field
        label="Owner name"
        name="ownerName"
        required
        errors={state.fieldErrors?.ownerName}
      />
      <Field
        label="Owner email"
        name="ownerEmail"
        type="email"
        required
        errors={state.fieldErrors?.ownerEmail}
      />
      <FormError message={state.error} />
      <div>
        <SubmitButton pendingText="Creating...">Create store</SubmitButton>
      </div>
    </form>
  );
}

function CopyButton({
  getText,
  children,
}: {
  getText: () => string;
  children: React.ReactNode;
}) {
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

function Credentials({
  storeName,
  slug,
  ownerEmail,
  tempPassword,
}: NonNullable<CreateStoreState["credentials"]>) {
  const storeUrl = () => `${window.location.origin}/store/${slug}`;
  const loginUrl = () => `${window.location.origin}/login`;
  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Store &ldquo;{storeName}&rdquo; created</CardTitle>
        <CardDescription>
          Copy these credentials now. The password is stored only as a hash and
          cannot be shown again once you leave this screen.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Store URL</dt>
            <dd>
              <Link
                href={`/store/${slug}`}
                target="_blank"
                className="font-mono underline underline-offset-4"
              >
                /store/{slug}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Owner email</dt>
            <dd className="font-mono">{ownerEmail}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Temporary password</dt>
            <dd
              data-testid="temp-password"
              className="font-mono text-base select-all"
            >
              {tempPassword}
            </dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">
          The owner must change this password on first login.
        </p>
        <div className="flex flex-wrap gap-2">
          <CopyButton getText={() => tempPassword}>Copy password</CopyButton>
          <CopyButton
            getText={() =>
              `Store: ${storeUrl()}\nLogin: ${loginUrl()}\nEmail: ${ownerEmail}\nTemporary password: ${tempPassword}`
            }
          >
            Copy all credentials
          </CopyButton>
          <Link
            href="/platform/stores"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Done, back to stores
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createStoreAction, type CreateStoreState } from "./actions";
import {
  JOINT_CONTROLLER_SUMMARY,
  JOINT_CONTROLLER_VERSION,
} from "@/lib/consent/agreement";
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
import { cn } from "@/lib/utils";

export function CreateStoreForm({
  timeZones,
  defaultTimeZone,
  defaultLocale,
}: {
  timeZones: { value: string; label: string }[];
  defaultTimeZone: string;
  defaultLocale: string;
}) {
  const [state, action] = useActionState<CreateStoreState, FormData>(
    createStoreAction,
    {},
  );

  if (state.credentials) return <Credentials {...state.credentials} />;

  return (
    <form action={action} className="grid max-w-md gap-6">
      <div className="grid gap-4">
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
      </div>

      {/* The store's privacy identity. Required at creation because a storefront that measures
        * visitors has to name a controller and a contact on its privacy page, and a store with
        * these blank cannot be put into the analytics rollout. */}
      <fieldset className="grid gap-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Privacy and reporting</legend>
        <Field
          label="Responsible business name"
          name="privacyControllerName"
          required
          hint="Shown to shoppers on this store's privacy page as the business responsible for it."
          errors={state.fieldErrors?.privacyControllerName}
        />
        <Field
          label="Privacy contact email"
          name="privacyEmail"
          type="email"
          required
          hint="Where shoppers' privacy questions about this store go."
          errors={state.fieldErrors?.privacyEmail}
        />
        <Field
          label="Merchant privacy policy URL"
          name="privacyPolicyUrl"
          type="url"
          placeholder="https://"
          hint="Optional. Leave empty if the merchant has none."
          errors={state.fieldErrors?.privacyPolicyUrl}
        />
        <Select
          label="Storefront language"
          name="defaultLocale"
          defaultValue={defaultLocale}
          hint="The language the cookie notice opens in. Shoppers can switch it themselves."
          options={[
            { value: "en", label: "English" },
            { value: "ar", label: "العربية (Arabic)" },
          ]}
          errors={state.fieldErrors?.defaultLocale}
        />
        <Select
          label="Reporting time zone"
          name="analyticsTimezone"
          defaultValue={defaultTimeZone}
          hint="Decides where this store's business day starts and ends in its reports."
          options={timeZones}
          errors={state.fieldErrors?.analyticsTimezone}
        />
      </fieldset>

      <label className="flex items-start gap-3 rounded-lg border p-4 text-sm">
        <input
          type="checkbox"
          name="jointControllerAccepted"
          value="on"
          className="mt-0.5 size-4 shrink-0"
        />
        <span className="grid gap-1">
          <span className="font-medium">
            Joint-controller terms (version {JOINT_CONTROLLER_VERSION}) apply to this merchant
          </span>
          <span className="text-muted-foreground">{JOINT_CONTROLLER_SUMMARY}</span>
          {state.fieldErrors?.jointControllerAccepted?.map((e) => (
            <span key={e} className="text-destructive">
              {e}
            </span>
          ))}
        </span>
      </label>

      {/*
        Hand-rolled like the checkbox above, rather than through a shared primitive: these are
        the only two checkboxes in the platform console, and inventing a component for a pair is
        a components refactor wearing a feature's clothes. Unlike the terms above, leaving this
        unticked is a valid answer — the schema has it optional for exactly that reason.
      */}
      <label className="flex items-start gap-3 rounded-lg border p-4 text-sm">
        <input
          type="checkbox"
          name="counterSalesEnabled"
          value="on"
          className="mt-0.5 size-4 shrink-0"
        />
        <span className="grid gap-1">
          <span className="font-medium">This store sells over a counter</span>
          <span className="text-muted-foreground">
            Adds a till to the owner&apos;s panel, where they and their staff can record cash or
            card sales made in person. Stock comes out of the same shelf as online orders. You can
            turn this on or off later from the store&apos;s Counter sales page.
          </span>
        </span>
      </label>

      <FormError message={state.error} />
      <div>
        <SubmitButton pendingText="Creating...">Create store</SubmitButton>
      </div>
    </form>
  );
}

/** A labelled <select> with the same shape as Field, which only wraps <input>. */
function Select({
  label,
  name,
  options,
  hint,
  errors,
  defaultValue,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  hint?: string;
  errors?: string[];
  defaultValue?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        aria-invalid={!!errors?.length}
        className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && !errors?.length && <p className="text-xs text-muted-foreground">{hint}</p>}
      {errors?.map((e) => (
        <p key={e} className="text-sm text-destructive">
          {e}
        </p>
      ))}
    </div>
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
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            Done, back to stores
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

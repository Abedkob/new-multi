"use client";

import { useActionState, useState } from "react";
import { FormError } from "@/components/field";
import { ImageField } from "@/components/image-field";
import { SubmitButton } from "@/components/submit-button";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/validation";
import { importStoreImageAction, saveBrandingAction, uploadStoreImageAction } from "../actions";

export function FaviconForm({
  slug,
  storeName,
  initial,
  fallback,
}: {
  slug: string;
  storeName: string;
  initial: string | null;
  /** The generated letter icon shown when no favicon is set. */
  fallback: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(
    saveBrandingAction.bind(null, slug),
    {},
  );
  const [url, setUrl] = useState(initial ?? "");
  const shown = url || fallback;
  const errors = state.fieldErrors?.faviconUrl;

  return (
    <form action={action} className="grid max-w-xl gap-5">
      <div className="grid gap-1.5">
        <Label htmlFor="faviconUrl">Favicon</Label>
        <ImageField
          id="faviconUrl"
          name="faviconUrl"
          value={url}
          onChange={setUrl}
          invalid={!!errors?.length}
          uploadAction={uploadStoreImageAction.bind(null, slug)}
          importAction={importStoreImageAction.bind(null, slug)}
        />
        <p className="text-xs text-muted-foreground">
          A square PNG, 512&times;512 or larger (it&apos;s also used when the store is added to a
          phone&apos;s home screen). Leave empty to use the generated letter icon.
        </p>
        {errors?.map((e) => (
          <p key={e} className="text-sm text-destructive">
            {e}
          </p>
        ))}
      </div>

      <div className="grid gap-2">
        <span className="text-xs text-muted-foreground">Preview</span>
        <div className="flex items-end gap-4">
          {/* A mock browser tab, at the real 16px size. */}
          <div className="flex w-56 items-center gap-2 rounded-t-lg border border-b-0 bg-muted/60 px-3 py-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of an arbitrary icon URL */}
            <img src={shown} alt="" className="size-4 shrink-0 object-contain" />
            <span className="truncate text-xs">{storeName}</span>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of an arbitrary icon URL */}
          <img src={shown} alt="Favicon preview" className="size-16 rounded-xl border object-contain" />
        </div>
      </div>

      <FormError message={state.error} />
      {state.ok && (
        <p className="text-sm text-muted-foreground">
          Saved. Browsers cache favicons, so a hard refresh may be needed to see it.
        </p>
      )}
      <div>
        <SubmitButton pendingText="Saving...">Save</SubmitButton>
      </div>
    </form>
  );
}

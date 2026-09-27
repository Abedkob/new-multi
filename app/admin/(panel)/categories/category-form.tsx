"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { CategoryFormState } from "./actions";
import { Field, FormError } from "@/components/field";
import { ImageField } from "@/components/image-field";
import { SubmitButton } from "@/components/submit-button";
import { buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { resolveMessage, useT } from "@/lib/i18n/context";

export type ParentOption = { id: string; label: string; depth: number };

/** Controlled so an upload can fill it; the form's remount-on-error resets it to the echoed value. */
function CategoryImageField({ defaultValue, errors }: { defaultValue: string; errors?: string[] }) {
  const [url, setUrl] = useState(defaultValue);
  const t = useT();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="imageUrl">{t("categories.form.imageLabel")}</Label>
      <ImageField id="imageUrl" name="imageUrl" value={url} onChange={setUrl} invalid={!!errors?.length} />
      {errors?.map((e) => (
        <p key={e} className="text-sm text-destructive">
          {resolveMessage(t, e)}
        </p>
      ))}
    </div>
  );
}

export function CategoryForm({
  action,
  parents,
  defaults = { name: "", parentId: "", imageUrl: "" },
  submitLabel,
}: {
  action: (prev: CategoryFormState, formData: FormData) => Promise<CategoryFormState>;
  /** Only this store's categories (and, when editing, never the category itself or its descendants). */
  parents: ParentOption[];
  defaults?: { name: string; parentId: string; imageUrl?: string | null };
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const v = { ...defaults, ...state.values };
  const errors = state.fieldErrors ?? {};
  const t = useT();

  return (
    <form
      // Remount after an error so the echoed values become the new defaults.
      key={state.values ? JSON.stringify(state.values) : "initial"}
      action={formAction}
      className="grid max-w-md gap-4"
    >
      <Field
        label={t("common.name")}
        name="name"
        defaultValue={v.name}
        required
        errors={errors.name?.map((e) => resolveMessage(t, e))}
      />
      <CategoryImageField defaultValue={v.imageUrl || ""} errors={errors.imageUrl} />
      <div className="grid gap-1.5">
        <Label htmlFor="parentId">{t("categories.form.parentLabel")}</Label>
        <select
          id="parentId"
          name="parentId"
          defaultValue={v.parentId}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">{t("categories.form.noneTopLevel")}</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {"   ".repeat(p.depth)}
              {p.depth > 0 ? "└ " : ""}
              {p.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">{t("categories.form.nestHelp")}</p>
        {errors.parentId?.map((e) => (
          <p key={e} className="text-sm text-destructive">
            {resolveMessage(t, e)}
          </p>
        ))}
      </div>
      <FormError message={state.error && resolveMessage(t, state.error)} />
      <div className="flex gap-2">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Link href="/admin/categories" className={buttonVariants({ variant: "ghost" })}>
          {t("common.cancel")}
        </Link>
      </div>
    </form>
  );
}

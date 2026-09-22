"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { CategoryFormState } from "./actions";
import { Field, FormError } from "@/components/field";
import { SubmitButton } from "@/components/submit-button";
import { buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export type ParentOption = { id: string; label: string; depth: number };

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

  return (
    <form
      // Remount after an error so the echoed values become the new defaults.
      key={state.values ? JSON.stringify(state.values) : "initial"}
      action={formAction}
      className="grid max-w-md gap-4"
    >
      <Field label="Name" name="name" defaultValue={v.name} required errors={errors.name} />
      <Field label="Image URL" name="imageUrl" defaultValue={v.imageUrl || ""} type="url" errors={errors.imageUrl} placeholder="https://..." />
      <div className="grid gap-1.5">
        <Label htmlFor="parentId">Parent category</Label>
        <select
          id="parentId"
          name="parentId"
          defaultValue={v.parentId}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">None (top level)</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {"   ".repeat(p.depth)}
              {p.depth > 0 ? "└ " : ""}
              {p.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Nest as deep as you like, for example Men &rarr; Shoes &rarr; Nike.
        </p>
        {errors.parentId?.map((e) => (
          <p key={e} className="text-sm text-destructive">
            {e}
          </p>
        ))}
      </div>
      <FormError message={state.error} />
      <div className="flex gap-2">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Link href="/admin/categories" className={buttonVariants({ variant: "ghost" })}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

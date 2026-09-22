"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { CategoryError, createCategory, deleteCategory, updateCategory } from "@/lib/data/categories";
import { requireOwner } from "@/lib/session";
import { categorySchema, type FormState } from "@/lib/validation";

export type CategoryFormState = FormState & {
  // Echoed back so the form keeps what was typed after an error.
  values?: { name: string; parentId: string; imageUrl?: string };
};

function read(formData: FormData) {
  const raw = {
    name: String(formData.get("name") ?? ""),
    parentId: String(formData.get("parentId") ?? ""),
    imageUrl: String(formData.get("imageUrl") ?? ""),
  };
  return { raw, parsed: categorySchema.safeParse(raw) };
}

export async function createCategoryAction(
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const { tenantId } = await requireOwner();
  const { raw, parsed } = read(formData);
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values: raw };
  }
  try {
    await createCategory(tenantId, parsed.data);
  } catch (e) {
    if (e instanceof CategoryError) return { error: e.message, values: raw };
    throw e;
  }
  redirect("/admin/categories");
}

export async function updateCategoryAction(
  id: string,
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const { tenantId } = await requireOwner();
  const { raw, parsed } = read(formData);
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values: raw };
  }
  try {
    await updateCategory(tenantId, id, parsed.data);
  } catch (e) {
    if (e instanceof CategoryError) return { error: e.message, values: raw };
    throw e;
  }
  redirect("/admin/categories");
}

/** Blocked (with a clear message, nothing deleted) while the category has children or products. */
export async function deleteCategoryAction(
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by useActionState
  _prev: FormState,
): Promise<FormState> {
  const { tenantId } = await requireOwner();
  try {
    await deleteCategory(tenantId, id);
  } catch (e) {
    if (e instanceof CategoryError) return { error: e.message };
    throw e;
  }
  redirect("/admin/categories");
}

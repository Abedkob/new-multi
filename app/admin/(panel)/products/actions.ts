"use server";

import { notFound, redirect } from "next/navigation";
import type { z } from "zod";
import { ProductError, createProduct, deleteProduct, updateProduct } from "@/lib/data/products";
import { requireOwner } from "@/lib/session";
import { productFormSchema, type FormState, type ProductFormInput } from "@/lib/validation";

export type ProductActionState = FormState & {
  /** Keyed by path: "name", "price", "variants", "variants.0.stock", "variants.1.attributes"... */
  fieldErrors?: Record<string, string[] | undefined>;
};

function flatten(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

function toInput(p: z.output<typeof productFormSchema>) {
  return {
    name: p.name,
    description: p.description,
    basePriceCents: p.price,
    imageUrl: p.imageUrl,
    images: p.images,
    isBestSeller: p.isBestSeller,
    categoryId: p.categoryId,
    variants: p.variants.map((v) => ({
      id: v.id,
      attributes: v.attributes,
      stock: v.stock,
      priceCentsOverride: v.price,
      imageUrl: v.imageUrl,
    })),
  };
}

export async function createProductAction(input: ProductFormInput): Promise<ProductActionState> {
  const { tenantId } = await requireOwner();
  const parsed = productFormSchema.safeParse(input);
  if (!parsed.success) return { error: "Some fields need attention.", fieldErrors: flatten(parsed.error) };
  try {
    await createProduct(tenantId, toInput(parsed.data));
  } catch (e) {
    if (e instanceof ProductError) return { error: e.message };
    throw e;
  }
  redirect("/admin/products");
}

export async function updateProductAction(
  id: string,
  input: ProductFormInput,
): Promise<ProductActionState> {
  const { tenantId } = await requireOwner();
  const parsed = productFormSchema.safeParse(input);
  if (!parsed.success) return { error: "Some fields need attention.", fieldErrors: flatten(parsed.error) };
  try {
    // tenantId is in the WHERE clause, so another store's product id updates nothing.
    if (!(await updateProduct(tenantId, id, toInput(parsed.data)))) notFound();
  } catch (e) {
    if (e instanceof ProductError) return { error: e.message };
    throw e;
  }
  redirect("/admin/products");
}

export async function deleteProductAction(id: string) {
  const { tenantId } = await requireOwner();
  await deleteProduct(tenantId, id);
  redirect("/admin/products");
}

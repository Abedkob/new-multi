"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import {
  ProductError,
  createProduct,
  deleteProduct,
  setVariantStock,
  updateProduct,
} from "@/lib/data/products";
import { requireCapability } from "@/lib/permissions";
import { productFormSchema, type FormState, type ProductFormInput } from "@/lib/validation";
import { MAX_STOCK } from "@/lib/variants";

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
    lowStockThreshold: p.lowStockThreshold,
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
  const { tenantId, userId, name } = await requireCapability("products:write");
  const parsed = productFormSchema.safeParse(input);
  if (!parsed.success)
    return { error: "validation.someFieldsNeedAttention", fieldErrors: flatten(parsed.error) };
  try {
    // The actor travels with the write, so the opening balance of whatever stock this product
    // arrives with names a person. The data layer decides whether the ledger is on.
    await createProduct(tenantId, toInput(parsed.data), { userId, name });
  } catch (e) {
    if (e instanceof ProductError) return { error: e.code };
    throw e;
  }
  redirect("/admin/products");
}

export async function updateProductAction(
  id: string,
  input: ProductFormInput,
): Promise<ProductActionState> {
  const { tenantId, userId, name } = await requireCapability("products:write");
  const parsed = productFormSchema.safeParse(input);
  if (!parsed.success)
    return { error: "validation.someFieldsNeedAttention", fieldErrors: flatten(parsed.error) };
  try {
    // tenantId is in the WHERE clause, so another store's product id updates nothing.
    if (!(await updateProduct(tenantId, id, toInput(parsed.data), { userId, name }))) notFound();
  } catch (e) {
    if (e instanceof ProductError) return { error: e.code };
    throw e;
  }
  redirect("/admin/products");
}

export async function deleteProductAction(id: string) {
  const { tenantId, userId, name } = await requireCapability("products:write");
  // The actor travels with the delete, so the units it destroys are written off against a person
  // rather than vanishing (D90(iii)). Deleting a product is the most direct way there is to
  // destroy stock, and it was the one path with no ledger row.
  await deleteProduct(tenantId, id, { userId, name });
  redirect("/admin/products");
}

/**
 * Stock, and nothing else (D73, "products:stock").
 *
 * Its own action rather than a flag on `updateProductAction`, because that one replaces the
 * whole product — name, price, images, the variant set — from a form. Letting staff call it with
 * a narrower intent would mean trusting the submitted body to contain no other change, which is
 * not a permission check. This takes one variant and one number and can express nothing else.
 */
export async function setVariantStockAction(
  variantId: string,
  stock: number,
  /**
   * The figure the screen was showing when this person typed theirs (D89).
   *
   * Required, and not merely accepted: it is what turns this into a compare-and-swap. Before it,
   * two staff counting the same shelf overwrote each other with no error and no way to tell.
   */
  expect: number,
): Promise<FormState> {
  const { tenantId, userId, name } = await requireCapability("products:stock");
  // One ceiling, shared with the product form's own validation (D89). These two used to disagree:
  // the form admitted nine digits while this refused anything over a million.
  if (!Number.isInteger(stock) || stock < 0 || stock > MAX_STOCK) {
    return { error: "validation.someFieldsNeedAttention" };
  }
  if (!Number.isInteger(expect) || expect < 0) {
    return { error: "validation.someFieldsNeedAttention" };
  }
  // Scoped through the product, because ProductVariant has no tenantId of its own.
  const result = await setVariantStock(tenantId, variantId, stock, { userId, name }, expect);
  if (!result.ok && result.reason === "NOT_FOUND") notFound();
  // Somebody else changed the figure between the one this person was shown and this write. Say so
  // with the live number rather than overwriting their count, which is what used to happen
  // silently when two staff counted the same shelf.
  if (!result.ok) {
    return { error: `products.stock.changedElsewhere|${result.current}` };
  }
  revalidatePath("/admin/products");
  return { ok: true };
}

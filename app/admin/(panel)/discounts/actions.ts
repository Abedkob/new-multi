"use server";

import { notFound, redirect } from "next/navigation";
import type { z } from "zod";
import {
  archiveDiscount,
  createDiscount,
  DiscountError,
  restoreDiscount,
  setDiscountAssignmentsForProducts,
  updateDiscount,
} from "@/lib/data/discounts";
import { requireOwner } from "@/lib/session";
import {
  discountFormSchema,
  type DiscountFormInput,
  type FormState,
} from "@/lib/validation";

export type DiscountActionState = FormState & {
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

export async function createDiscountAction(
  input: DiscountFormInput,
): Promise<DiscountActionState> {
  const { tenantId } = await requireOwner();
  const parsed = discountFormSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Some fields need attention.", fieldErrors: flatten(parsed.error) };
  }
  try {
    const discount = await createDiscount(tenantId, parsed.data);
    redirect(`/admin/discounts/${discount.id}/edit?section=products`);
  } catch (error) {
    if (error instanceof DiscountError) return { error: error.message };
    throw error;
  }
}

export async function updateDiscountAction(
  id: string,
  input: DiscountFormInput,
): Promise<DiscountActionState> {
  const { tenantId } = await requireOwner();
  const parsed = discountFormSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Some fields need attention.", fieldErrors: flatten(parsed.error) };
  }
  try {
    if (!(await updateDiscount(tenantId, id, parsed.data))) notFound();
  } catch (error) {
    if (error instanceof DiscountError) return { error: error.message };
    throw error;
  }
  redirect("/admin/discounts");
}

export async function archiveDiscountAction(id: string) {
  const { tenantId } = await requireOwner();
  if (!(await archiveDiscount(tenantId, id))) notFound();
  redirect("/admin/discounts");
}

export async function restoreDiscountAction(id: string) {
  const { tenantId } = await requireOwner();
  if (!(await restoreDiscount(tenantId, id))) notFound();
  redirect(`/admin/discounts/${id}/edit`);
}

export async function updateDiscountProductsAction(
  id: string,
  q: string,
  page: number,
  formData: FormData,
) {
  const { tenantId } = await requireOwner();
  const visible = formData.getAll("visibleProductIds").map(String);
  const selected = formData.getAll("selectedProductIds").map(String);
  try {
    await setDiscountAssignmentsForProducts(tenantId, id, visible, selected);
  } catch (error) {
    if (error instanceof DiscountError) redirect(`/admin/discounts/${id}/edit?section=products&assignmentError=1`);
    throw error;
  }
  const search = new URLSearchParams();
  search.set("section", "products");
  if (q) search.set("q", q);
  if (page > 1) search.set("page", String(page));
  redirect(`/admin/discounts/${id}/edit?${search}`);
}

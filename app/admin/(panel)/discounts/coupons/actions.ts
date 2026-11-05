"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import {
  archiveCoupon, CouponError, createCoupon, restoreCoupon, setCouponEnabled, updateCoupon,
} from "@/lib/data/coupons";
import { requireCapability } from "@/lib/permissions";
import { couponFormSchema, type CouponFormInput, type FormState } from "@/lib/validation";

export type CouponActionState = FormState & { fieldErrors?: Record<string, string[] | undefined>; revision?: number };

function flatten(error: z.ZodError) {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) (out[issue.path.join(".") || "form"] ??= []).push(issue.message);
  return out;
}

export async function createCouponAction(input: CouponFormInput): Promise<CouponActionState> {
  const { tenantId } = await requireCapability("discounts:write");
  const parsed = couponFormSchema.safeParse(input);
  if (!parsed.success) return { error: "validation.someFieldsNeedAttention", fieldErrors: flatten(parsed.error) };
  try {
    await createCoupon(tenantId, parsed.data);
  } catch (error) {
    if (error instanceof CouponError) return { error: error.code };
    throw error;
  }
  redirect("/admin/discounts/coupons?created=1");
}

export async function updateCouponAction(id: string, input: CouponFormInput): Promise<CouponActionState> {
  const { tenantId } = await requireCapability("discounts:write");
  const parsed = couponFormSchema.safeParse(input);
  if (!parsed.success) return { error: "validation.someFieldsNeedAttention", fieldErrors: flatten(parsed.error) };
  try {
    const coupon = await updateCoupon(tenantId, id, parsed.data);
    revalidatePath("/admin/discounts/coupons");
    return { ok: true, revision: coupon.revision };
  } catch (error) {
    if (error instanceof CouponError) return { error: error.code };
    throw error;
  }
}

export async function setCouponEnabledAction(id: string, enabled: boolean) {
  const { tenantId } = await requireCapability("discounts:write");
  const result = await setCouponEnabled(tenantId, id, enabled);
  if (!result.count) notFound();
  revalidatePath("/admin/discounts/coupons");
}

export async function archiveCouponAction(id: string) {
  const { tenantId } = await requireCapability("discounts:write");
  const result = await archiveCoupon(tenantId, id);
  if (!result.count) notFound();
  redirect("/admin/discounts/coupons");
}

export async function restoreCouponAction(id: string) {
  const { tenantId } = await requireCapability("discounts:write");
  const result = await restoreCoupon(tenantId, id);
  if (!result.count) notFound();
  redirect(`/admin/discounts/coupons/${id}/edit?restored=1`);
}

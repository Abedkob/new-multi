"use server";

import { revalidatePath } from "next/cache";
import {
  StaffError,
  createStaffAccount,
  resetStaffPassword,
  revokeStaffAccount,
} from "@/lib/data/staff";
import { generateTempPassword, hashPassword } from "@/lib/passwords";
import { requireCapability } from "@/lib/permissions";
import { staffAccountSchema, type FormState } from "@/lib/validation";

/**
 * Adding and removing staff. Owner only — "staff:manage" is not among the six capabilities a
 * staff account holds, so a staff member cannot promote a colleague or remove themselves (D73).
 *
 * Every one of these three leaves an audit row, written by lib/data/staff.ts rather than here:
 * the log is append-only and the owner cannot read it, which is the point — a record of who was
 * given access to a store's orders and customer details has to outlive the person who granted
 * it, and must not be editable by them. Putting the write in the data layer means an action
 * cannot omit it.
 */

export type StaffActionState = FormState & {
  fieldErrors?: Record<string, string[] | undefined>;
  /**
   * The first password, returned ONCE so the owner can pass it on. Never stored in plain text
   * and never written to the audit detail — if this is lost, the owner resets it.
   */
  firstPassword?: string;
  values?: { name: string; email: string };
};

export async function addStaffAction(
  _previous: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const { tenantId, userId, email: actorEmail } = await requireCapability("staff:manage");
  const submitted = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
  };
  const parsed = staffAccountSchema.safeParse(submitted);
  if (!parsed.success) {
    return {
      error: "validation.someFieldsNeedAttention",
      fieldErrors: parsed.error.flatten().fieldErrors,
      values: submitted,
    };
  }

  const firstPassword = generateTempPassword();
  try {
    await createStaffAccount(
      tenantId,
      {
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash: await hashPassword(firstPassword),
      },
      { userId, email: actorEmail },
    );
  } catch (error) {
    if (error instanceof StaffError) return { error: `staff.error.${error.code}`, values: submitted };
    throw error;
  }

  revalidatePath("/admin/staff");
  return { ok: true, firstPassword };
}

export async function revokeStaffAction(staffUserId: string): Promise<StaffActionState> {
  const { tenantId, userId, email: actorEmail } = await requireCapability("staff:manage");
  // The data layer scopes by tenant AND by role, so this can never remove an owner or another
  // store's staff however it is called.
  const removed = await revokeStaffAccount(tenantId, staffUserId, { userId, email: actorEmail });
  if (!removed) return { error: "staff.error.NOT_FOUND" };
  revalidatePath("/admin/staff");
  return { ok: true };
}

export async function resetStaffPasswordAction(staffUserId: string): Promise<StaffActionState> {
  const { tenantId, userId, email: actorEmail } = await requireCapability("staff:manage");
  const firstPassword = generateTempPassword();
  const reset = await resetStaffPassword(
    tenantId,
    staffUserId,
    await hashPassword(firstPassword),
    { userId, email: actorEmail },
  );
  if (!reset) return { error: "staff.error.NOT_FOUND" };
  revalidatePath("/admin/staff");
  return { ok: true, firstPassword };
}

"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { unstable_update } from "@/auth";
import { setPassword } from "@/lib/data/users";
import { hashPassword } from "@/lib/passwords";
import { requireOwner } from "@/lib/session";
import { changePasswordSchema, type FormState } from "@/lib/validation";

export async function changePasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { userId } = await requireOwner({ allowMustChange: true });

  const parsed = changePasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  await setPassword(userId, await hashPassword(parsed.data.password));
  // Re-issues the session cookie; the jwt callback re-reads
  // mustChangePassword from the database.
  await unstable_update({});
  redirect("/admin");
}

"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn } from "@/auth";
import { setPassword } from "@/lib/data/users";
import { hashPassword } from "@/lib/passwords";
import { requireOwner } from "@/lib/session";
import { changePasswordSchema, type FormState } from "@/lib/validation";

export async function changePasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { userId, email } = await requireOwner({ allowMustChange: true });

  const parsed = changePasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  // Bumps sessionVersion: every other session (e.g. one an attacker holds) is revoked.
  await setPassword(userId, await hashPassword(parsed.data.password));
  // Revocation includes this session's own token, so sign in again with the new password to get
  // a fresh one carrying the new version (and mustChangePassword: false). Not unstable_update():
  // the jwt callback deliberately never refreshes sessionVersion on update.
  await signIn("credentials", { email, password: parsed.data.password, redirect: false });
  redirect("/admin");
}

"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { homeForRole } from "@/lib/roles";
import { loginSchema, type FormState } from "@/lib/validation";

export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Enter your email and password." };

  const { email, password } = parsed.data;
  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (e) {
    if (e instanceof AuthError) return { error: "Invalid email or password." };
    throw e;
  }

  // Credentials were just verified, so looking up the role leaks nothing.
  const user = await prisma.user.findUnique({
    where: { email },
    select: { role: true },
  });
  // STORE_OWNERs with mustChangePassword get bounced onward by proxy.ts.
  redirect(homeForRole(user?.role));
}

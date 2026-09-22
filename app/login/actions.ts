"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { RATE_LIMITS, clientIp, rateLimit, retryAfterText } from "@/lib/rate-limit";
import { homeForRole } from "@/lib/roles";
import { loginSchema, type FormState } from "@/lib/validation";

export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ip = clientIp(await headers());
  const limit = rateLimit(`login:${ip}`, RATE_LIMITS.login);
  if (!limit.ok) {
    return { error: `Too many sign-in attempts. Try again in ${retryAfterText(limit.retryAfterMs)}.` };
  }

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

"use server";

import { z } from "zod";
import { EmailTakenError, createStoreWithOwner } from "@/lib/data/tenants";
import { generateTempPassword, hashPassword } from "@/lib/passwords";
import { requirePlatformAdmin } from "@/lib/session";
import { createStoreSchema, type FormState } from "@/lib/validation";

export type CreateStoreState = FormState & {
  // Returned once in this action's response; never persisted or logged.
  credentials?: {
    storeName: string;
    slug: string;
    ownerEmail: string;
    tempPassword: string;
  };
};

export async function createStoreAction(
  _prev: CreateStoreState,
  formData: FormData,
): Promise<CreateStoreState> {
  await requirePlatformAdmin();

  const parsed = createStoreSchema.safeParse({
    storeName: formData.get("storeName"),
    ownerName: formData.get("ownerName"),
    ownerEmail: formData.get("ownerEmail"),
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const tempPassword = generateTempPassword();
  try {
    const { tenant, user } = await createStoreWithOwner({
      ...parsed.data,
      passwordHash: await hashPassword(tempPassword),
    });
    return {
      ok: true,
      credentials: {
        storeName: tenant.name,
        slug: tenant.slug,
        ownerEmail: user.email,
        tempPassword,
      },
    };
  } catch (e) {
    if (e instanceof EmailTakenError) {
      return { fieldErrors: { ownerEmail: [e.message] } };
    }
    console.error("createStore failed:", e instanceof Error ? e.message : e);
    return { error: "Could not create the store. Please try again." };
  }
}

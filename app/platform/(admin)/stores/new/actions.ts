"use server";

import { z } from "zod";
import { JOINT_CONTROLLER_VERSION } from "@/lib/consent/agreement";
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
  const admin = await requirePlatformAdmin();

  const parsed = createStoreSchema.safeParse({
    storeName: formData.get("storeName"),
    ownerName: formData.get("ownerName"),
    ownerEmail: formData.get("ownerEmail"),
    privacyControllerName: formData.get("privacyControllerName"),
    privacyEmail: formData.get("privacyEmail"),
    privacyPolicyUrl: formData.get("privacyPolicyUrl") ?? "",
    defaultLocale: formData.get("defaultLocale"),
    analyticsTimezone: formData.get("analyticsTimezone"),
    jointControllerAccepted: formData.get("jointControllerAccepted"),
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const { storeName, ownerName, ownerEmail, ...privacy } = parsed.data;
  const tempPassword = generateTempPassword();
  try {
    const { tenant, user } = await createStoreWithOwner({
      storeName,
      ownerName,
      ownerEmail,
      passwordHash: await hashPassword(tempPassword),
      privacy: {
        privacyControllerName: privacy.privacyControllerName,
        privacyEmail: privacy.privacyEmail,
        privacyPolicyUrl: privacy.privacyPolicyUrl,
        defaultLocale: privacy.defaultLocale,
        analyticsTimezone: privacy.analyticsTimezone,
        // Who recorded the terms is taken from the authenticated session, never the form.
        jointControllerRecordedBy: admin.userId,
        jointControllerVersion: JOINT_CONTROLLER_VERSION,
      },
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

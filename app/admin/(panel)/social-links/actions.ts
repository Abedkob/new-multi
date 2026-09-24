"use server";

import { revalidatePath } from "next/cache";
import { updateTenantSocialLinks } from "@/lib/data/tenants";
import { requireOwner } from "@/lib/session";
import {
  SOCIAL_LINK_FIELDS,
  socialLinksSchema,
  type SocialLinkKey,
} from "@/lib/social-links";
import type { FormState } from "@/lib/validation";

export type SocialLinksActionState = FormState & {
  values?: Record<SocialLinkKey, string>;
};

export async function saveSocialLinksAction(
  _previous: SocialLinksActionState,
  formData: FormData,
): Promise<SocialLinksActionState> {
  const { tenantId } = await requireOwner();
  const submitted = Object.fromEntries(
    SOCIAL_LINK_FIELDS.map(({ key }) => [key, String(formData.get(key) ?? "")]),
  ) as Record<SocialLinkKey, string>;
  const parsed = socialLinksSchema.safeParse(submitted);

  if (!parsed.success) {
    return {
      error: "Check the highlighted links and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
      values: submitted,
    };
  }

  const saved = await updateTenantSocialLinks(tenantId, parsed.data);
  revalidatePath("/admin/social-links");

  return {
    ok: true,
    values: Object.fromEntries(
      SOCIAL_LINK_FIELDS.map(({ key }) => [key, saved[key] ?? ""]),
    ) as Record<SocialLinkKey, string>,
  };
}

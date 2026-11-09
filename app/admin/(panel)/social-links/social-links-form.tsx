"use client";

import { useActionState } from "react";
import { saveSocialLinksAction } from "./actions";
import { Field, FormActions } from "@/components/field";
import { SocialPlatformIcon } from "@/components/social-platform-icon";
import { SubmitButton } from "@/components/submit-button";
import { SectionCard } from "@/components/admin/section-card";
import { resolveMessage, useT } from "@/lib/i18n/context";
import { SOCIAL_LINK_FIELDS, type SocialLinkKey } from "@/lib/social-links";

export function SocialLinksForm({
  defaults,
}: {
  defaults: Record<SocialLinkKey, string>;
}) {
  const [state, action] = useActionState(saveSocialLinksAction, {});
  const t = useT();
  const values = { ...defaults, ...state.values };

  return (
    <form action={action} className="grid max-w-2xl gap-4">
      <SectionCard title={t("socialLinks.form.title")} bodyClassName="grid gap-5 p-4">
        {SOCIAL_LINK_FIELDS.map(({ key, platform, label, placeholder }) => {
          const errors = state.fieldErrors?.[key];
          const isWhatsapp = platform === "whatsapp";
          // Brand names (Instagram/Facebook/TikTok/WhatsApp) stay as-is in any locale; "Visit
          // us" is the one non-brand label, and lib/social-links.ts is shared with the
          // storefront footer, so the Arabic override lives here rather than in that constant.
          const displayLabel = platform === "googleMaps" ? t("socialLinks.visitUs") : label;
          return (
            <Field
              key={key}
              name={key}
              label={
                <>
                  <SocialPlatformIcon platform={platform} className="text-muted-foreground" />
                  {displayLabel}
                </>
              }
              type={isWhatsapp ? "tel" : "url"}
              inputMode={isWhatsapp ? "tel" : "url"}
              autoComplete={isWhatsapp ? "tel" : "url"}
              defaultValue={values[key]}
              placeholder={placeholder}
              hint={isWhatsapp ? t("socialLinks.form.whatsappHelp") : undefined}
              errors={errors?.map((m) => resolveMessage(t, m))}
            />
          );
        })}
        <p className="text-sm text-muted-foreground">{t("socialLinks.form.emptyHidesNote")}</p>
      </SectionCard>

      <FormActions
        status={state.ok ? t("socialLinks.form.saved") : undefined}
        error={state.error && resolveMessage(t, state.error)}
      >
        <SubmitButton>{t("socialLinks.form.submit")}</SubmitButton>
      </FormActions>
    </form>
  );
}

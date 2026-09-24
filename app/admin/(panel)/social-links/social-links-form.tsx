"use client";

import { useActionState } from "react";
import { saveSocialLinksAction } from "./actions";
import { SocialPlatformIcon } from "@/components/social-platform-icon";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SOCIAL_LINK_FIELDS, type SocialLinkKey } from "@/lib/social-links";

export function SocialLinksForm({
  defaults,
}: {
  defaults: Record<SocialLinkKey, string>;
}) {
  const [state, action] = useActionState(saveSocialLinksAction, {});
  const values = { ...defaults, ...state.values };

  return (
    <form action={action} className="grid max-w-2xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Profiles, contact and location</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          {SOCIAL_LINK_FIELDS.map(({ key, platform, label, placeholder }) => {
            const errors = state.fieldErrors?.[key];
            const isWhatsapp = platform === "whatsapp";
            return (
              <div key={key} className="grid gap-1.5">
                <Label htmlFor={key} className="inline-flex items-center gap-2">
                  <SocialPlatformIcon platform={platform} className="text-muted-foreground" />
                  {label}
                </Label>
                <Input
                  id={key}
                  name={key}
                  type={isWhatsapp ? "tel" : "url"}
                  inputMode={isWhatsapp ? "tel" : "url"}
                  autoComplete={isWhatsapp ? "tel" : "url"}
                  defaultValue={values[key]}
                  placeholder={placeholder}
                  aria-invalid={!!errors?.length}
                  aria-describedby={errors?.length ? `${key}-error` : undefined}
                />
                {isWhatsapp && !errors?.length && (
                  <p className="text-xs text-muted-foreground">
                    Lebanese local numbers are accepted. We add the country code when needed.
                  </p>
                )}
                {errors?.map((message) => (
                  <p id={`${key}-error`} key={message} className="text-sm text-destructive">
                    {message}
                  </p>
                ))}
              </div>
            );
          })}
          <p className="text-sm text-muted-foreground">
            Leave a field empty to hide it from your storefront footer.
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-background px-4 py-3 sm:sticky sm:bottom-3 sm:z-10 sm:-mx-1 sm:bg-background/95 sm:shadow-lg sm:backdrop-blur">
        <SubmitButton>Save social links</SubmitButton>
        {state.ok && <p role="status" className="text-sm text-green-700">Social links saved.</p>}
        {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      </div>
    </form>
  );
}

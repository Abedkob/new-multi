"use client";

import { useActionState } from "react";
import { AtSign, MapPin, Music2, Users } from "lucide-react";
import { saveSocialLinksAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SOCIAL_LINK_FIELDS, type SocialLinkKey } from "@/lib/social-links";

const ICONS = {
  instagram: AtSign,
  facebook: Users,
  tiktok: Music2,
  googleMaps: MapPin,
};

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
          <CardTitle>Profiles and location</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          {SOCIAL_LINK_FIELDS.map(({ key, platform, label, placeholder }) => {
            const Icon = ICONS[platform];
            const errors = state.fieldErrors?.[key];
            return (
              <div key={key} className="grid gap-1.5">
                <Label htmlFor={key} className="inline-flex items-center gap-2">
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  {label}
                </Label>
                <Input
                  id={key}
                  name={key}
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  defaultValue={values[key]}
                  placeholder={placeholder}
                  aria-invalid={!!errors?.length}
                  aria-describedby={errors?.length ? `${key}-error` : undefined}
                />
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

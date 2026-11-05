"use client";

import { useActionState } from "react";
import { ExternalLink } from "lucide-react";
import { saveOwnerIntegrationsAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveMessage, useLocale, useT } from "@/lib/i18n/context";
import { INTEGRATION_GUIDES } from "@/lib/integrations-guide";
import type { IntegrationKey } from "@/lib/integrations";

/**
 * One card per integration: what it does, how to set it up, the field, and how to check it.
 *
 * The guide sits beside the field rather than behind a link, because the alternative is an
 * owner pasting the wrong thing into a field whose instructions are one click away. The "how to
 * check" step is not decoration either — the failure this screen invites is an owner who saves
 * an id, reads "Saved", and believes they are measuring something.
 *
 * Text comes from the dictionary, so every line here exists in Arabic too (it is a compile
 * error otherwise). `lib/integrations-guide.ts` holds the structure.
 */
export function IntegrationsForm({
  defaults,
  storeHost,
  lastChanged,
}: {
  defaults: Record<IntegrationKey, string>;
  /** The host the store actually serves on, for the per-domain verification warning. */
  storeHost: string | null;
  /**
   * Who last changed each field, and when (D40b). Only fields that have ever been changed
   * appear; a never-touched field shows nothing rather than "never", which would be noise on
   * five cards out of six for a new store.
   */
  lastChanged: Partial<Record<IntegrationKey, { actorLabel: string; actorRole: string; at: string }>>;
}) {
  const [state, action] = useActionState(saveOwnerIntegrationsAction, {});
  const t = useT();
  // The date is formatted in the reader's own language: an Arabic dashboard showing "5 November"
  // is the sort of half-translated line that makes the rest look machine-made.
  const { locale } = useLocale();
  const values = { ...defaults, ...state.values };

  return (
    <form action={action} className="grid max-w-3xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("integrations.page.title")}</CardTitle>
          <CardDescription>{t("integrations.page.description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground">
          <p>{t("integrations.paste.hint")}</p>
          <p>{t("integrations.consent.notice")}</p>
          <p>{t("integrations.verification.notice")}</p>
          <p>{t("integrations.audit.notice")}</p>
        </CardContent>
      </Card>

      {INTEGRATION_GUIDES.map((guide) => {
        const errors = state.fieldErrors?.[guide.key];
        const value = values[guide.key] ?? "";
        return (
          <Card key={guide.key}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {t(guide.labelKey)}
                <span
                  className={
                    value
                      ? "rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                      : "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                  }
                >
                  {value ? t("integrations.status.on") : t("integrations.status.off")}
                </span>
              </CardTitle>
              <CardDescription>{t(guide.purposeKey)}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <p className="text-sm font-medium">{t("integrations.guide.heading")}</p>
                <ol className="ms-4 grid list-decimal gap-1 text-sm text-muted-foreground">
                  {guide.stepKeys.map((stepKey) => (
                    <li key={stepKey}>{t(stepKey)}</li>
                  ))}
                </ol>
                {/* D40a: Meta and Google verify a DOMAIN, so the warning names the one this
                    store actually serves on. */}
                {!guide.needsAdvertisingConsent && (
                  <p className="text-sm text-muted-foreground">
                    {storeHost
                      ? resolveMessage(t, `integrations.customDomain.notice\u0001${storeHost}`)
                      : t("integrations.customDomain.none")}
                  </p>
                )}
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor={guide.key}>{t(guide.labelKey)}</Label>
                <Input
                  id={guide.key}
                  name={guide.key}
                  defaultValue={value}
                  placeholder={guide.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  dir="ltr"
                  aria-invalid={!!errors?.length}
                  aria-describedby={errors?.length ? `${guide.key}-error` : `${guide.key}-hint`}
                />
                {errors?.length ? (
                  errors.map((message) => (
                    <p id={`${guide.key}-error`} key={message} className="text-sm text-destructive">
                      {resolveMessage(t, message)}
                    </p>
                  ))
                ) : (
                  <p id={`${guide.key}-hint`} className="text-xs text-muted-foreground">
                    {t("integrations.clearHint")}
                  </p>
                )}
              </div>

              {/* Who touched this field last. The audit log is the source, and this is the only
                  part of it the owner can see: an actor and a time, for this field, newest
                  only (D40b). "I didn't change that" is the first thing said when a tag stops
                  reporting, and until now the answer lived where only the platform could read
                  it. */}
              {lastChanged[guide.key] ? (
                <p className="text-xs text-muted-foreground" data-last-changed={guide.key}>
                  {resolveMessage(
                    t,
                    `integrations.lastChanged${lastChanged[guide.key]!.actorLabel}${new Date(
                      lastChanged[guide.key]!.at,
                    ).toLocaleDateString(locale === "ar" ? "ar" : "en-GB", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}`,
                  )}
                  {lastChanged[guide.key]!.actorRole === "platform-admin"
                    ? ` ${t("integrations.lastChanged.byPlatform")}`
                    : ""}
                </p>
              ) : null}

              <div className="grid gap-1.5 rounded-md bg-muted/50 p-3">
                <p className="text-sm font-medium">{t("integrations.guide.check")}</p>
                <p className="text-sm text-muted-foreground">{t(guide.check.expectKey)}</p>
                <a
                  href={guide.check.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex w-fit items-center gap-1.5 text-sm font-medium underline"
                >
                  {resolveMessage(t, `integrations.guide.checkWith\u0001${guide.check.tool}`)}
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>{t("integrations.save")}</SubmitButton>
        {state.ok && <p className="text-sm text-muted-foreground">{t("integrations.saved")}</p>}
        {state.error && (
          <p className="text-sm text-destructive">{resolveMessage(t, state.error)}</p>
        )}
      </div>
    </form>
  );
}

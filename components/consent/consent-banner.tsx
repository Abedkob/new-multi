"use client";

/**
 * The consent notice: a bottom sheet, plus the "Manage choices" dialog.
 *
 * Requirements this file is answering directly (§4.3):
 *
 *  - Nothing non-essential is preselected. Both switches start off, every time the dialog opens
 *    from an undecided state.
 *  - Accept and Reject have comparable prominence: same element, same size, same weight, side by
 *    side. One is filled and one is outlined, which is the only difference between them.
 *  - Withdrawal is as easy as acceptance: Cookie settings in the footer is one click to this
 *    dialog, where Reject is one more. Same number of clicks as accepting was.
 *  - Arabic uses scoped RTL: `dir` is set on the notice and the dialog only, never on <html>, so
 *    an Arabic notice on an English storefront does not flip the whole shop.
 *  - Colours come from the store's theme tokens, so the notice belongs to the storefront it
 *    appears in rather than looking bolted on.
 */

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Check, Cookie, ShieldCheck } from "lucide-react";
import { useConsent, type ConsentController } from "@/components/consent/consent-context";
import { fillConsentTokens } from "@/lib/consent/copy";
import { DENY_ALL, type ConsentGrants } from "@/lib/consent/types";
import { cn } from "@/lib/utils";

/** Identical geometry for the two primary choices; only the fill differs. */
const ACTION = "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md px-5 text-sm font-semibold transition-colors disabled:opacity-60 sm:flex-initial";
const ACTION_FILLED = "bg-primary text-primary-foreground hover:opacity-90";
const ACTION_OUTLINED = "border border-foreground/30 bg-transparent text-foreground hover:bg-foreground/5";
const QUIET = "inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm underline underline-offset-4 transition-colors hover:text-primary";

export function ConsentBanner() {
  const consent = useConsent();
  if (!consent) return null;

  const { state, copy, storeName, privacyHref, locale, pending, setLocale, decide } = consent;

  return (
    <>
      {state.needsPrompt && (
        <section
          dir={copy.dir}
          data-testid="consent-banner"
          role="region"
          aria-label={copy.banner.title}
          className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background text-foreground shadow-[0_-8px_30px_rgba(0,0,0,0.12)]"
        >
          <div className="mx-auto grid max-w-5xl gap-4 px-5 py-5 sm:px-8 sm:py-6">
            <div className="flex items-start gap-3">
              <Cookie className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <div className="grid gap-1.5">
                <h2 className="text-base font-semibold">{copy.banner.title}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {fillConsentTokens(copy.banner.body, { store: storeName })}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  data-testid="consent-accept-all"
                  disabled={pending}
                  onClick={() => decide("BANNER_ACCEPT_ALL")}
                  className={cn(ACTION, ACTION_FILLED)}
                >
                  {copy.banner.acceptAll}
                </button>
                <button
                  type="button"
                  data-testid="consent-reject"
                  disabled={pending}
                  onClick={() => decide("BANNER_REJECT")}
                  className={cn(ACTION, ACTION_OUTLINED)}
                >
                  {copy.banner.reject}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  data-testid="consent-manage"
                  disabled={pending}
                  onClick={consent.openManage}
                  className={cn(QUIET, "text-muted-foreground")}
                >
                  {copy.banner.manage}
                </button>
                <a href={privacyHref} className={cn(QUIET, "text-muted-foreground")}>
                  {copy.banner.privacyLink}
                </a>
                <button
                  type="button"
                  data-testid="consent-language-switch"
                  lang={locale === "en" ? "ar" : "en"}
                  onClick={() => setLocale(locale === "en" ? "ar" : "en")}
                  className={cn(QUIET, "text-muted-foreground")}
                >
                  {copy.otherLanguageLabel}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
      <ManageDialog />
    </>
  );
}

function ManageDialog() {
  const consent = useConsent();
  if (!consent) return null;
  const { state, copy, locale, pending, manageOpen, setManageOpen, setLocale, decide } = consent;

  return (
    <Dialog.Root open={manageOpen} onOpenChange={setManageOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          dir={copy.dir}
          data-testid="consent-manage-dialog"
          className="fixed left-1/2 top-1/2 z-50 grid max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border border-border bg-background p-6 text-foreground shadow-2xl transition-all duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
        >
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">{copy.manage.title}</Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              {copy.manage.intro}
            </Dialog.Description>
          </div>
          {/* Mounted only while the dialog is open (base-ui unmounts a closed popup), which is
            * what re-seeds the draft below: an abandoned, unsaved toggle is gone on reopen. */}
          <ManageCategories consent={consent} />
          {state.publicRef && (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">{copy.manage.referenceLabel}</p>
              <p className="mt-1 font-mono text-[11px] [overflow-wrap:anywhere]" data-testid="consent-reference">
                {state.publicRef}
              </p>
              <p className="mt-1">{copy.manage.referenceHint}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              lang={locale === "en" ? "ar" : "en"}
              onClick={() => setLocale(locale === "en" ? "ar" : "en")}
              className={cn(QUIET, "text-muted-foreground")}
            >
              {copy.otherLanguageLabel}
            </button>
            <button
              type="button"
              data-testid="consent-withdraw"
              disabled={pending}
              onClick={() => decide("FOOTER_WITHDRAW")}
              className={cn(ACTION, ACTION_OUTLINED, "flex-initial")}
            >
              {state.decided && (state.grants.analytics || state.grants.advertising)
                ? copy.manage.withdraw
                : copy.manage.reject}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The per-category switches and Save.
 *
 * The draft starts from the recorded decision, and from DENY_ALL when there is none — which is
 * what "no non-essential option is preselected" means in practice. It needs no effect to stay
 * honest: this component only exists while the dialog is open, so opening it computes the
 * initial draft afresh and an abandoned, unsaved toggle cannot survive to the next open.
 *
 * The controller arrives as a prop rather than from useConsent() so that there is no early
 * return above the hook below.
 */
function ManageCategories({ consent }: { consent: ConsentController }) {
  const { state, copy, pending, decide } = consent;

  const [draft, setDraft] = useState<ConsentGrants>(state.decided ? state.grants : DENY_ALL);

  const rows = [
    {
      key: "analytics" as const,
      label: copy.manage.analyticsLabel,
      description: copy.manage.analyticsDescription,
    },
    {
      key: "advertising" as const,
      label: copy.manage.advertisingLabel,
      description: copy.manage.advertisingDescription,
    },
  ];

  return (
    <div className="grid gap-3">
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4 text-primary" aria-hidden />
              {copy.manage.essentialLabel}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {copy.manage.essentialDescription}
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <Check className="size-3" aria-hidden />
            {copy.manage.alwaysOn}
          </span>
        </div>
      </div>

      {rows.map((row) => (
        <label
          key={row.key}
          className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-border p-4"
        >
          <span className="grid gap-1">
            <span className="text-sm font-semibold">{row.label}</span>
            <span className="text-xs leading-relaxed text-muted-foreground">{row.description}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            data-testid={`consent-category-${row.key}`}
            checked={draft[row.key]}
            disabled={pending}
            onChange={(event) => setDraft({ ...draft, [row.key]: event.target.checked })}
            className="mt-0.5 size-5 shrink-0 accent-[var(--color-primary)]"
          />
        </label>
      ))}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          data-testid="consent-save"
          disabled={pending}
          onClick={() => decide("MANAGE", draft)}
          className={cn(ACTION, ACTION_FILLED)}
        >
          {copy.manage.save}
        </button>
        <button
          type="button"
          data-testid="consent-accept-all-dialog"
          disabled={pending}
          onClick={() => decide("BANNER_ACCEPT_ALL")}
          className={cn(ACTION, ACTION_OUTLINED)}
        >
          {copy.manage.acceptAll}
        </button>
      </div>
    </div>
  );
}

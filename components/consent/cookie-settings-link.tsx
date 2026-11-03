"use client";

/**
 * The footer's Cookie settings entry — how a visitor gets back to their decision (§4.3:
 * withdrawal must be as easy as acceptance, and every storefront footer must expose this).
 *
 * Renders nothing when there is no consent provider above it. That is what keeps the notice out
 * of the admin content editor's live preview and the platform theme editor: both render real
 * template code, including this footer, without a storefront around it.
 */

import { useConsent } from "@/components/consent/consent-context";
import { cn } from "@/lib/utils";

export function CookieSettingsLink({ className }: { className?: string }) {
  const consent = useConsent();
  if (!consent) return null;
  return (
    <button
      type="button"
      data-testid="cookie-settings-link"
      onClick={consent.openManage}
      className={cn("inline-flex min-h-10 items-center transition-colors", className)}
    >
      {consent.copy.footer.cookieSettings}
    </button>
  );
}

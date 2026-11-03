"use client";

/**
 * Holds the visitor's consent decision for one store and renders the notice.
 *
 * Mounted by app/store/[slug]/layout.tsx only — never by templates/render or the admin/platform
 * preview routes, so no consent UI can appear while an owner is editing their storefront.
 *
 * After a decision is recorded the server layout has to re-render: it is what decides whether
 * the third-party tags are in the tree at all. router.refresh() does that, so gating stays a
 * server-side decision and the browser never has to be trusted to withhold a script it already
 * received.
 */

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordConsentAction } from "@/app/actions/consent";
import { ConsentBanner } from "@/components/consent/consent-banner";
import { ConsentContext, type ConsentController } from "@/components/consent/consent-context";
import { consentCopy } from "@/lib/consent/copy";
import {
  METHOD_GRANTS,
  type ConsentGrants,
  type ConsentLocale,
  type ConsentMethod,
  type ConsentState,
} from "@/lib/consent/types";

export function ConsentProvider({
  slug,
  storeName,
  privacyHref,
  initialState,
  children,
}: {
  slug: string;
  storeName: string;
  privacyHref: string;
  /** Decoded from the signed cookie by the server on this request. */
  initialState: ConsentState;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<ConsentState>(initialState);
  const [locale, setLocale] = useState<ConsentLocale>(initialState.locale);
  const [manageOpen, setManageOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const decide = useCallback(
    (method: ConsentMethod, grants?: ConsentGrants) => {
      const chosen = METHOD_GRANTS[method] ?? grants ?? state.grants;
      startTransition(async () => {
        const result = await recordConsentAction({
          slug,
          method,
          locale,
          analytics: chosen.analytics,
          advertising: chosen.advertising,
        });
        if (!result.ok) {
          // Nothing was recorded, so the notice stays exactly as it was and the visitor can try
          // again. Nothing is measured in the meantime, because refusal is the default.
          return;
        }
        setState(result.state);
        setManageOpen(false);
        // Picks up the tags the new grants allow (or drops the ones they no longer do).
        router.refresh();
      });
    },
    [locale, router, slug, state.grants],
  );

  const controller = useMemo<ConsentController>(
    () => ({
      state,
      locale,
      copy: consentCopy(locale),
      storeName,
      privacyHref,
      pending,
      manageOpen,
      openManage: () => setManageOpen(true),
      setManageOpen,
      setLocale,
      decide,
    }),
    [decide, locale, manageOpen, pending, privacyHref, state, storeName],
  );

  return (
    <ConsentContext.Provider value={controller}>
      {children}
      <ConsentBanner />
    </ConsentContext.Provider>
  );
}

"use client";

/**
 * The consent context, on its own and deliberately dependency-free.
 *
 * Why this is not in consent-provider.tsx: the footer's Cookie settings entry needs `useConsent`,
 * and the footer is shared template code that is also rendered outside Next entirely — the
 * verification scripts render every template through renderToStaticMarkup in a plain tsx
 * process. If that import chain reached the provider it would reach the server action, and from
 * there next/headers and Prisma. So the piece templates touch holds a context and nothing else.
 *
 * `useConsent()` returns null outside a provider, which is also what makes the storefront's own
 * no-op guarantee work: the admin content editor and the platform theme editor render real
 * template code without a provider, so the Cookie settings entry renders nothing there and no
 * consent UI can appear inside a preview. Same shape as useTrack() in lib/analytics.tsx.
 */

import { createContext, useContext } from "react";
import type { ConsentCopy } from "@/lib/consent/copy";
import type {
  ConsentGrants,
  ConsentLocale,
  ConsentMethod,
  ConsentState,
} from "@/lib/consent/types";

export type ConsentController = {
  state: ConsentState;
  /** Language the notice is currently displayed in (the visitor can switch it). */
  locale: ConsentLocale;
  copy: ConsentCopy;
  storeName: string;
  /** Where the store's privacy page lives, for the link in the notice. */
  privacyHref: string;
  /** True while a decision is being recorded. */
  pending: boolean;
  manageOpen: boolean;
  openManage: () => void;
  setManageOpen: (open: boolean) => void;
  setLocale: (locale: ConsentLocale) => void;
  /** `grants` is only read for the MANAGE method; the others have a fixed meaning. */
  decide: (method: ConsentMethod, grants?: ConsentGrants) => void;
};

export const ConsentContext = createContext<ConsentController | null>(null);

/** Null outside a storefront with consent mounted — callers must handle that, not assume it. */
export const useConsent = (): ConsentController | null => useContext(ConsentContext);

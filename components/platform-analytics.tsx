import Script from "next/script";
import { env } from "@/lib/env";

/**
 * The platform owner's own GA4 property — traffic to this deployment's own surfaces, not to any
 * store. Per-store tracking is a completely separate thing (lib/analytics.tsx).
 *
 * This used to sit in app/layout.tsx, which meant it ran on every route, storefronts included.
 * That is wrong twice over:
 *
 *  1. Consent. A shopper's refusal governs what runs on the storefront, and the platform's own
 *     measurement is not exempt from it just because the property belongs to us.
 *  2. Data. Shopper traffic across every store was being mixed into the platform's own property,
 *     so neither number meant what it claimed to.
 *
 * A root layout cannot fix this by itself: a server layout has no access to the pathname, so
 * there is nothing there to branch on. Hence the move — this is mounted by the surfaces that
 * should have it (admin, platform, login, the platform's own landing page) and by nothing else.
 * Storefront routes have no path to it at all, which is a stronger guarantee than a condition.
 *
 * Renders nothing when PLATFORM_GA_ID is unset, so a deployment can simply not have one.
 */
export function PlatformAnalytics() {
  const id = env.PLATFORM_GA_ID;
  if (!id) return null;
  return (
    <>
      <Script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`}
        strategy="afterInteractive"
      />
      <Script id="platform-gtag-init" strategy="afterInteractive">
        {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', ${JSON.stringify(id)});
          `}
      </Script>
    </>
  );
}

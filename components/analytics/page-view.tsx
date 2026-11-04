"use client";

/**
 * Emits one PAGE_VIEW per storefront page, including client-side navigations.
 *
 * The only emitter in Phase 2. Product views, cart, checkout and WhatsApp are Phase 3, and
 * searches are Phase 4; they will call useAnalytics().track the same way, which is why the
 * contract already carries all nine types.
 *
 * What is recorded is a page KIND, never a URL (§4.5) — "a product page was viewed", not which
 * address the visitor was at.
 */

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAnalytics } from "@/components/analytics/tracker";
import { pageKindFromPath } from "@/lib/analytics/request";

export function PageViewTracker({ basePath }: { basePath: string }) {
  const { track } = useAnalytics();
  const pathname = usePathname();
  // React may run an effect twice in development; a page view is not idempotent on our side
  // (each gets its own eventId), so guard on the path we last reported.
  const lastReported = useRef<string | null>(null);

  useEffect(() => {
    if (lastReported.current === pathname) return;
    lastReported.current = pathname;
    track({ type: "PAGE_VIEW", pageKind: pageKindFromPath(pathname, basePath) });
  }, [basePath, pathname, track]);

  return null;
}

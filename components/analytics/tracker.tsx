"use client";

/**
 * The browser side of collection (§7.4).
 *
 * An in-memory queue and nothing else. No durable retry, no localStorage, no reconstruction of
 * a lost batch on the next visit — if a flush fails, those events are gone. That is a deliberate
 * trade: the server deduplicates on eventId, so a *retried* beacon is free, but a *stored* queue
 * would mean a visitor's browsing is written to their disk and replayed later, which is both a
 * privacy liability and a source of events backdated into reports.
 *
 * Mounted only when the visitor granted analytics and the store is inside the rollout — the
 * storefront layout decides, so withdrawing consent unmounts this and the queue dies with it.
 *
 * Nothing here may ever surface to a shopper: every failure path is a swallowed promise.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import {
  ANALYTICS_SCHEMA_VERSION,
  MAX_BATCH_EVENTS,
  analyticsEventsPath,
  analyticsPresencePath,
  type AnalyticsEventType,
  type AttributionContext,
  type PageKind,
} from "@/lib/analytics/contract";
import { pageKindFromPath } from "@/lib/analytics/request";

/** Flush on this cadence, or sooner when the queue fills. */
const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_AT_EVENTS = 10;
/** Presence ping, only while the page is visible (§7.3). */
const PRESENCE_INTERVAL_MS = 60_000;

export type TrackInput = {
  type: AnalyticsEventType;
  /**
   * Omit it and the tracker derives it from the current path. Emitters that sit in shared state
   * (the cart provider) or deep inside a template then do not each need to know the store's
   * base path, and cannot disagree with each other about what kind of page this is.
   */
  pageKind?: PageKind;
  productId?: string;
  variantId?: string;
  quantity?: number;
  resultCount?: number;
  /**
   * Send this event now, by beacon, instead of waiting for the next flush. For a click that
   * takes the shopper off the page (the WhatsApp button), where the next flush may never come.
   * Never put on the wire — the envelope is strict.
   */
  immediate?: boolean;
};

type QueuedEvent = Omit<TrackInput, "pageKind" | "immediate"> & {
  eventId: string;
  occurredAt: number;
  pageKind: PageKind;
  attributionContext?: AttributionContext;
};

type Tracker = { track: (input: TrackInput) => void };

const NOOP: Tracker = { track: () => {} };
const TrackerContext = createContext<Tracker | null>(null);

/** Inert outside a storefront with collection active — previews, admin, a refusing visitor. */
export const useAnalytics = (): Tracker => useContext(TrackerContext) ?? NOOP;

/**
 * How this visit started, read once on mount. Only the referrer's HOSTNAME is taken, and an ad
 * click becomes a boolean — the click id itself identifies a person and is never sent.
 */
function readAttribution(): AttributionContext | undefined {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.search);
  const get = (key: string) => params.get(key)?.trim() || undefined;

  let referrerHost: string | undefined;
  try {
    if (document.referrer) {
      const url = new URL(document.referrer);
      // Same-site navigation is not an acquisition source.
      if (url.hostname !== window.location.hostname) referrerHost = url.hostname;
    }
  } catch {
    // Unparseable referrer: treat as direct.
  }

  const context: AttributionContext = {
    source: get("utm_source"),
    medium: get("utm_medium"),
    campaign: get("utm_campaign"),
    content: get("utm_content"),
    referrerHost,
    hasAdClick: params.has("gclid") || params.has("fbclid"),
  };
  // Drop undefined keys: the envelope schema is strict, and an all-empty object is noise.
  const cleaned = Object.fromEntries(
    Object.entries(context).filter(([, v]) => v !== undefined && v !== false),
  );
  return Object.keys(cleaned).length ? (cleaned as AttributionContext) : undefined;
}

/**
 * A version-4 UUID, which is what the contract requires of an eventId — and the deduplication
 * key, so a malformed one is not a cosmetic problem: the endpoint refuses the whole batch.
 *
 * `crypto.randomUUID` exists only in a SECURE CONTEXT. localhost counts as one and https does,
 * but a store reached over plain http on its own domain does not, and there the old fallback
 * produced "<millis>-<random>" — not a UUID, so every single batch from that page was rejected
 * with a 400 and silently lost. `crypto.getRandomValues` has no such restriction, so it is the
 * real fallback; Math.random is only the last resort for an environment that has neither.
 */
function newEventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // Version 4, variant 1, per RFC 4122.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function AnalyticsTracker({
  basePath,
  token,
  children,
}: {
  /** "" on a custom domain, "/store/<slug>" on the shared host. */
  basePath: string;
  /** Minted per render by the storefront layout; tenant-bound and short-lived. */
  token: string;
  children: React.ReactNode;
}) {
  const queue = useRef<QueuedEvent[]>([]);
  const attribution = useRef<AttributionContext | undefined>(undefined);
  /** Sent with the first batch only; after that the session already carries its source. */
  const attributionSent = useRef(false);
  const endpoint = analyticsEventsPath(basePath);
  const presenceEndpoint = analyticsPresencePath(basePath);

  const flush = useCallback(
    (useBeacon: boolean) => {
      if (queue.current.length === 0) return;
      // Take at most one batch; anything beyond waits for the next flush.
      const events = queue.current.splice(0, MAX_BATCH_EVENTS);
      const body = JSON.stringify({
        schemaVersion: ANALYTICS_SCHEMA_VERSION,
        sentAt: Date.now(),
        token,
        events,
      });

      try {
        // sendBeacon is the only delivery that reliably survives the page going away, which is
        // exactly when the last batch of a visit is sitting in this queue.
        if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
          const ok = navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
          if (ok) return;
        }
        void fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Dropped. The visitor is shopping; this is not their problem.
      }
    },
    [endpoint, token],
  );

  const track = useCallback(
    (input: TrackInput) => {
      const { immediate, ...rest } = input;
      const event: QueuedEvent = {
        ...rest,
        pageKind:
          input.pageKind ??
          (typeof window === "undefined"
            ? "other"
            : pageKindFromPath(window.location.pathname, basePath)),
        eventId: newEventId(),
        occurredAt: Date.now(),
      };
      if (!attributionSent.current) {
        attribution.current ??= readAttribution();
        if (attribution.current) event.attributionContext = attribution.current;
        attributionSent.current = true;
      }
      queue.current.push(event);
      if (immediate) flush(true);
      else if (queue.current.length >= FLUSH_AT_EVENTS) flush(false);
    },
    [basePath, flush],
  );

  useEffect(() => {
    const interval = setInterval(() => flush(false), FLUSH_INTERVAL_MS);

    // A page being hidden is the last reliable moment to send; pagehide covers the back/forward
    // cache, which visibilitychange alone misses on iOS.
    const onHide = () => flush(true);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      flush(true);
    };
  }, [flush]);

  // Presence: only while visible, so a tab left open in the background is not counted as a
  // person standing in the shop (§7.3).
  useEffect(() => {
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      void fetch(presenceEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: ANALYTICS_SCHEMA_VERSION, token }),
        keepalive: true,
      }).catch(() => {});
    };
    ping();
    const interval = setInterval(ping, PRESENCE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [presenceEndpoint, token]);

  const value = useMemo<Tracker>(() => ({ track }), [track]);
  return <TrackerContext.Provider value={value}>{children}</TrackerContext.Provider>;
}

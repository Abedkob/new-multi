/**
 * The analytics wire contract: one definition of the envelope, shared by the browser tracker,
 * the ingestion endpoint and the verification scripts.
 *
 * Pure (zod only), so it is safe in a client bundle. Nothing here reads the environment or the
 * database — validation must be identical on both sides of the wire.
 *
 * Two shaping rules, both from STOREFRONT_ANALYTICS_MASTER_PLAN.md §7.1 and §12.1:
 *
 *  1. The client never supplies tenant id, visitor id, session id, country, device class,
 *     authoritative money values or order status. Every schema here is `.strict()`, so sending
 *     one of those is not ignored — it is a 400. A field the browser cannot set is a field that
 *     cannot be forged.
 *  2. The envelope is transport-neutral. A future Redis Stream and worker can accept this exact
 *     shape without the storefront changing.
 */

import { z } from "zod";

export const ANALYTICS_SCHEMA_VERSION = 1;

/** §7.4: the endpoint accepts at most this many events in one batch. */
export const MAX_BATCH_EVENTS = 20;

/** §12.1: ~15–20KB. Anything larger is refused before it is parsed. */
export const MAX_BODY_BYTES = 20 * 1024;

/** How far a client clock may differ before its timestamp is clamped (§7.5 step 5). */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;
/** Events older than this are clamped rather than trusted: a stale queue is not history. */
export const MAX_EVENT_AGE_MS = 6 * 60 * 60_000;

/**
 * Normalized page kinds. A URL is never stored (§4.5) — "which kind of page was this" is what
 * the funnel needs, and it is all a merchant report can honestly show.
 */
export const PAGE_KINDS = [
  "home",
  "shop",
  "category",
  "product",
  "cart",
  "checkout",
  "search",
  "page",
  "other",
] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

/**
 * §7.2. All nine exist in the contract from the start so that Phase 3 (product, cart, checkout,
 * WhatsApp) and Phase 4 (search) add emitters rather than endpoint changes or migrations.
 * Phase 2 emits PAGE_VIEW only.
 */
export const ANALYTICS_EVENT_TYPES = [
  "PAGE_VIEW",
  "PRODUCT_VIEW",
  "SEARCH_SUBMITTED",
  "SEARCH_RESULT_CLICK",
  "ADD_TO_CART",
  "REMOVE_FROM_CART",
  "CART_VIEW",
  "CHECKOUT_STARTED",
  "WHATSAPP_ORDER_CLICK",
] as const;
export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

/**
 * What the page can see about how the visitor arrived (§3.5). The client reads these from its
 * own URL and referrer; the server sanitizes and decides what to keep.
 *
 * `hasAdClick` is a boolean on purpose: the presence of gclid/fbclid is useful for attribution,
 * the value identifies a click and is never stored.
 */
export const attributionContextSchema = z
  .object({
    source: z.string().trim().max(80).optional(),
    medium: z.string().trim().max(80).optional(),
    campaign: z.string().trim().max(120).optional(),
    content: z.string().trim().max(120).optional(),
    /** Hostname only, never a full referring URL. */
    referrerHost: z.string().trim().max(255).optional(),
    hasAdClick: z.boolean().optional(),
  })
  .strict();

export type AttributionContext = z.infer<typeof attributionContextSchema>;

export const analyticsEventSchema = z
  .object({
    /** Client-generated UUID. The deduplication key, which is what makes a retried beacon free. */
    eventId: z.uuid(),
    type: z.enum(ANALYTICS_EVENT_TYPES),
    /** Epoch milliseconds on the client's clock; clamped server-side. */
    occurredAt: z.number().int().positive(),
    pageKind: z.enum(PAGE_KINDS),
    /** Verified to belong to this tenant before anything is written (§7.5 step 7). */
    productId: z.string().trim().min(1).max(64).optional(),
    variantId: z.string().trim().min(1).max(64).optional(),
    quantity: z.number().int().min(1).max(999).optional(),
    /** Normalized and PII-scrubbed server-side; Phase 4 starts emitting these. */
    searchQuery: z.string().max(200).optional(),
    resultCount: z.number().int().min(0).max(100_000).optional(),
    attributionContext: attributionContextSchema.optional(),
  })
  .strict();

export type AnalyticsEventInput = z.infer<typeof analyticsEventSchema>;

export const analyticsEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(ANALYTICS_SCHEMA_VERSION),
    sentAt: z.number().int().positive(),
    /**
     * The tenant-bound bootstrap token. In the body rather than a header because
     * `navigator.sendBeacon` cannot set request headers, and the beacon is the only delivery
     * that survives a page being closed — the one moment a batch most needs to arrive.
     */
    token: z.string().min(1).max(512),
    events: z.array(analyticsEventSchema).min(1).max(MAX_BATCH_EVENTS),
  })
  .strict();

export type AnalyticsEnvelope = z.infer<typeof analyticsEnvelopeSchema>;

/**
 * Paths of the two public endpoints, built in one place so the tracker cannot drift.
 *
 * They live UNDER the storefront path, not under /api, and that is load-bearing: the consent
 * cookie is scoped to `/store/<slug>` (§4.4, so one store's decision is never sent to another),
 * and a browser simply would not attach it to a request for `/api/...`. An endpoint outside the
 * cookie's path sees every visitor as undecided and silently discards everything they send.
 *
 * It also makes custom domains work without a special case: proxy.ts rewrites
 * `<domain>/analytics/events` to this same route, same origin, cookie path `/`.
 *
 * `basePath` is "" for a store on its own domain and "/store/<slug>" otherwise — the value the
 * storefront already computes for every internal link.
 */
export const analyticsEventsPath = (basePath: string) => `${basePath}/analytics/events`;
export const analyticsPresencePath = (basePath: string) => `${basePath}/analytics/presence`;

/** The absolute, path-based form, for scripts and server-side callers that only have a slug. */
export const analyticsEventsPathForSlug = (slug: string) =>
  analyticsEventsPath(`/store/${encodeURIComponent(slug)}`);
export const analyticsPresencePathForSlug = (slug: string) =>
  analyticsPresencePath(`/store/${encodeURIComponent(slug)}`);

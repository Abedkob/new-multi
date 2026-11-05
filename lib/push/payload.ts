/**
 * What a push notification is allowed to say (D50).
 *
 * This module is the enforcement point, not a convention. The rule is: **the fact, the count,
 * and where to go.** A notification body lands on a lock screen, is readable by anyone holding
 * the phone, and sits on Apple's or Google's infrastructure on the way. So:
 *
 *   - **Customer identity is never sent.** Not a name, phone, address or note, under any
 *     setting. This is not a preference, because nobody would knowingly choose it and the person
 *     it exposes is not the one choosing.
 *   - **The product list is never sent.** "2 × Linen Shirt" tells a stranger what the shop sells
 *     and what the customer bought, and adds nothing to "you have a new order".
 *   - **Money is opt-in and off by default.** "New order — $340" tells whoever glances at the
 *     phone what the shop takes in. The owner may switch it on; nobody switches it on for them.
 *
 * The *mechanism* is as important as the rule: `buildNewOrderPayload` takes a **count** and an
 * optional **total**, not an order. It cannot leak a customer field because it is never given
 * one, and a future caller cannot pass one in without changing this signature — which is a
 * reviewable diff rather than an accident. `verify:notifications` asserts both halves: that the
 * builder's input type carries no customer field, and that a real body read back out of the
 * ledger contains none of the fixture's customer data.
 */

import type { NotificationType } from "@/generated/prisma/client";

export type PushPayload = {
  title: string;
  body: string;
  /** Collapses retries and replaces an earlier copy on the device (D52). */
  tag: string;
  /** Where a tap goes. A path, never an absolute URL: the device opens the installed app. */
  destination: string;
  /** Set so a right-to-left body is drawn right-to-left on the lock screen (D58). */
  lang: "en" | "ar";
  dir: "ltr" | "rtl";
};

export type PushText = { title: string; body: string };

/** The tag for a batch of new orders: stable per recipient and triggering order (§11.5). */
export const newOrderTag = (recipientUserId: string, orderId: string) =>
  `owner-order:${recipientUserId}:${orderId}`;

export const alertTag = (type: NotificationType, recipientUserId: string, entityKey: string) =>
  `${type.toLowerCase()}:${recipientUserId}:${entityKey}`;

export type NewOrderFacts = {
  /** How many orders this notification covers. Never zero — there is nothing to say. */
  count: number;
  /**
   * The combined total, in cents, ONLY when the owner asked for it (D50). `null` means either
   * the owner did not ask or nobody looked it up; both produce the same body, so a glance at a
   * notification cannot tell whether a figure was withheld.
   */
  totalCents: number | null;
};

/**
 * The one builder for a new-order notification.
 *
 * `text` arrives already localized (lib/notifications/templates.ts owns the wording in both
 * languages); this assembles the payload and nothing else. The split exists so that the rule
 * about what may be in a body is checkable in one place even though the sentences live in the
 * dictionaries.
 */
export function buildNewOrderPayload(input: {
  facts: NewOrderFacts;
  text: PushText;
  recipientUserId: string;
  triggerOrderId: string;
  locale: "en" | "ar";
  destination?: string;
}): PushPayload {
  if (input.facts.count < 1) {
    throw new Error("a new-order notification must cover at least one order");
  }
  return {
    title: input.text.title,
    body: input.text.body,
    tag: newOrderTag(input.recipientUserId, input.triggerOrderId),
    destination: input.destination ?? "/admin/orders",
    lang: input.locale,
    dir: input.locale === "ar" ? "rtl" : "ltr",
  };
}

export function buildAlertPayload(input: {
  type: NotificationType;
  text: PushText;
  recipientUserId: string;
  entityKey: string;
  locale: "en" | "ar";
  destination: string;
}): PushPayload {
  return {
    title: input.text.title,
    body: input.text.body,
    tag: alertTag(input.type, input.recipientUserId, input.entityKey),
    destination: input.destination,
    lang: input.locale,
    dir: input.locale === "ar" ? "rtl" : "ltr",
  };
}

/**
 * Field names that must never appear in a payload, for the check that enforces D50.
 *
 * Exported so the rule is one list rather than a regex copied into a script: adding a field to
 * `Order` that should never be pushed means adding it here.
 */
export const FORBIDDEN_PAYLOAD_FIELDS = [
  "customerName",
  "customerPhone",
  "customerAddress",
  "deliveryLocation",
  "notes",
  "items",
  "orderItems",
  "variantId",
] as const;

/**
 * The last gate before a payload is handed to a push service.
 *
 * Belt and braces: the builders above cannot produce a forbidden field because they are never
 * given one, and this catches a body assembled anywhere else — a template with a stray
 * interpolation, say. It looks at the rendered strings, because that is what actually leaves the
 * server.
 */
export function assertPayloadIsSafe(payload: PushPayload, forbiddenValues: readonly string[] = []) {
  const text = `${payload.title}\n${payload.body}`;
  for (const value of forbiddenValues) {
    const trimmed = value.trim();
    if (trimmed.length >= 4 && text.toLowerCase().includes(trimmed.toLowerCase())) {
      throw new Error(`a push payload must not contain customer data (matched "${trimmed}")`);
    }
  }
  return payload;
}

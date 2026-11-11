/**
 * What each notification says, in both languages (§11.3, D58).
 *
 * The wording lives here rather than in the dictionaries for one reason: a notification is
 * rendered by a **scheduled job** as well as by a request, and the dictionaries are reached
 * through `getT()`, which reads a cookie. At 09:00 on Monday there is no request and no cookie.
 *
 * So these are plain functions of a locale and some numbers, and they are the only place a
 * notification's sentences exist. Every type has both languages, and the Arabic is written as
 * Arabic sentences rather than word-for-word from the English — an Arabic body assembled from
 * translated fragments reads like a machine wrote it, which on a lock screen is the difference
 * between a merchant trusting the notification and dismissing it.
 *
 * Money appears in exactly one template, and only when the owner asked for it (D50).
 */

import { formatPrice } from "@/lib/format";
import type { PushText } from "@/lib/push/payload";

export type NotificationLocale = "en" | "ar";

/** Arabic-Indic digits, because "لديك 3 طلبات" with Western digits reads as half-translated. */
const arabicNumber = (value: number) =>
  String(value).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);

const number = (value: number, locale: NotificationLocale) =>
  locale === "ar" ? arabicNumber(value) : String(value);

/**
 * New orders (§11.4, §11.6).
 *
 * One sentence for one order, a count for several. The total is appended only when
 * `totalCents` is given, which happens only when the owner switched the amount on.
 */
export function newOrderText(
  locale: NotificationLocale,
  facts: { count: number; totalCents: number | null },
): PushText {
  const { count, totalCents } = facts;
  const amount = totalCents === null ? "" : ` — ${formatPrice(totalCents)}`;

  if (locale === "ar") {
    return {
      title: count === 1 ? "طلب جديد" : "طلبات جديدة",
      body:
        count === 1
          ? `لديك طلب جديد${amount}.`
          : `لديك ${arabicNumber(count)} طلبات جديدة${amount}.`,
    };
  }
  return {
    title: count === 1 ? "New order" : "New orders",
    body: count === 1 ? `You have a new order${amount}.` : `You have ${count} new orders${amount}.`,
  };
}

/** The owner's Monday summary (§11.7). Built in commit 8; the wording lives here from the start. */
export function weeklySummaryText(
  locale: NotificationLocale,
  facts: { topProduct: string | null; problem: string | null; unmetSearch: string | null },
): PushText {
  const lines: string[] = [];
  if (locale === "ar") {
    if (facts.topProduct) lines.push(`الأكثر طلبًا: ${facts.topProduct}`);
    if (facts.problem) lines.push(facts.problem);
    else lines.push("لم تظهر مشكلة واضحة هذا الأسبوع");
    if (facts.unmetSearch) lines.push(`بحثوا عن: ${facts.unmetSearch}`);
    return { title: "ملخص الأسبوع", body: lines.join(" · ") };
  }
  if (facts.topProduct) lines.push(`Best seller: ${facts.topProduct}`);
  if (facts.problem) lines.push(facts.problem);
  else lines.push("No clear problem showed up this week");
  if (facts.unmetSearch) lines.push(`Searched for: ${facts.unmetSearch}`);
  return { title: "Your week", body: lines.join(" · ") };
}

/**
 * An owner alert (§11.8).
 *
 * Cautious by construction: every one of these describes what was counted and stops. There is no
 * template here that says "because", and none that tells a merchant what to do — §6's register,
 * now on a lock screen, where there is no room to qualify a claim and no chance to read the
 * evidence first.
 */
/**
 * "Running low" (D96).
 *
 * Its own function rather than another `kind` in `ownerAlertText`, because that one builds the
 * ANALYTICS alerts: its kinds mirror the insight kinds in `ALERTABLE`, and its `facts.reference`
 * means "the same figure in the period before". A low-stock alert has no period and infers
 * nothing — it is a count on a shelf against a number the owner typed in.
 *
 * `others` is how many MORE products are also low, so one sweep is one notification however many
 * crossed at once. Like every template here it says what was counted and stops: no "because", and
 * nothing telling the merchant what to order.
 */
export function lowStockText(
  locale: NotificationLocale,
  facts: { product: string; left: number; threshold: number; others: number },
): PushText {
  const n = (value: number) => number(value, locale);
  if (locale === "ar") {
    return {
      title: "المخزون يقترب من النفاد",
      body:
        facts.others === 0
          ? `${facts.product}: بقي ${n(facts.left)} والحدّ الذي حددته ${n(facts.threshold)}.`
          : `${facts.product} و${n(facts.others)} منتجاً آخر يقترب مخزونها من النفاد.`,
    };
  }
  return {
    title: "Running low",
    body:
      facts.others === 0
        ? `${facts.product}: ${facts.left} left, your limit is ${facts.threshold}.`
        : `${facts.product} and ${facts.others} more products are running low.`,
  };
}

export function ownerAlertText(
  locale: NotificationLocale,
  kind: "product" | "funnel" | "search" | "traffic",
  facts: { subject: string; current: number; reference: number },
): PushText {
  const n = (value: number) => number(value, locale);
  if (locale === "ar") {
    switch (kind) {
      case "product":
        return {
          title: "منتج يستحق النظر",
          body: `${facts.subject}: ${n(facts.current)} مشاهدة و${n(facts.reference)} تصرّف.`,
        };
      case "funnel":
        return {
          title: "خطوة يتوقف عندها الزوار",
          body: `${facts.subject}: تجاوزها ${n(facts.current)} من ${n(facts.reference)}.`,
        };
      case "search":
        return {
          title: "بحث دون نتيجة",
          body: `«${facts.subject}»: ${n(facts.current)} بحثًا دون أي نتيجة.`,
        };
      case "traffic":
        return {
          title: "تغيّر في الزيارات",
          body: `${n(facts.current)} زيارة مقابل ${n(facts.reference)} في الفترة السابقة.`,
        };
    }
  }
  switch (kind) {
    case "product":
      return {
        title: "A product worth a look",
        body: `${facts.subject}: ${facts.current} views and ${facts.reference} actions.`,
      };
    case "funnel":
      return {
        title: "A step visitors stop at",
        body: `${facts.subject}: ${facts.current} of ${facts.reference} continued.`,
      };
    case "search":
      return {
        title: "Searched for, not found",
        body: `“${facts.subject}”: ${facts.current} searches returned nothing.`,
      };
    case "traffic":
      return {
        title: "Visits changed",
        body: `${facts.current} visits against ${facts.reference} in the period before.`,
      };
  }
}

/**
 * A platform alert (§11.10).
 *
 * English only, deliberately: these go to this platform's own operators, not to merchants.
 * Store names may appear; customer or order data never does.
 */
export function platformAlertText(
  kind:
    | "inactive-store"
    | "store-decline"
    | "ingestion"
    | "contract-rejection"
    | "aggregation"
    | "redis"
    | "push-delivery",
  facts: { subject: string; detail: string },
): PushText {
  switch (kind) {
    case "inactive-store":
      return { title: "Store went quiet", body: `${facts.subject}: ${facts.detail}` };
    case "store-decline":
      return { title: "Store declining", body: `${facts.subject}: ${facts.detail}` };
    case "ingestion":
      return { title: "Ingestion failing", body: facts.detail };
    case "contract-rejection":
      // Its own text, because this one means our own code is losing data (P6-25).
      return { title: "Events refused by the contract", body: facts.detail };
    case "aggregation":
      return { title: "Aggregation behind", body: facts.detail };
    case "redis":
      return { title: "Redis unavailable", body: facts.detail };
    case "push-delivery":
      return { title: "Push delivery failing", body: facts.detail };
  }
}

export function platformWeeklyText(facts: {
  stores: number;
  active: number;
  growing: number;
  declining: number;
  inactive: number;
}): PushText {
  return {
    title: "Platform week",
    body:
      `${facts.active} of ${facts.stores} stores active · ` +
      `${facts.growing} growing, ${facts.declining} declining, ${facts.inactive} quiet`,
  };
}

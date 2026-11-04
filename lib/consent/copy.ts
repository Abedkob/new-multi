/**
 * Every word the consent notice and the privacy page say, in English and Arabic.
 *
 * Pure data: imported by client components, the privacy page, and the verification scripts. One
 * approved wording is used for every store (§4.3) — only the store name, the controller details,
 * the direction and the theme colours differ.
 *
 * TODO(legal): the strings marked below are structurally complete and deliberately cautious, but
 * they have NOT been through local legal review, which §4.1/§4.3 require before launch.
 * Replacing them is a text edit in this file: no component, no type and no test depends on their
 * wording, only on their keys.
 *
 * Arabic is written as Arabic sentences rather than translated fragments, and the UI scopes
 * `dir="rtl"` to the notice instead of flipping the whole storefront.
 */

import type { ConsentLocale } from "@/lib/consent/types";

export type ConsentCopy = {
  dir: "ltr" | "rtl";
  /** Name of the other language, shown on the switch inside the notice. */
  otherLanguageLabel: string;
  banner: {
    title: string;
    /** {store} is replaced with the store's name. */
    body: string;
    acceptAll: string;
    reject: string;
    manage: string;
    privacyLink: string;
    close: string;
  };
  manage: {
    title: string;
    intro: string;
    essentialLabel: string;
    essentialDescription: string;
    alwaysOn: string;
    analyticsLabel: string;
    analyticsDescription: string;
    advertisingLabel: string;
    advertisingDescription: string;
    save: string;
    acceptAll: string;
    reject: string;
    withdraw: string;
    currentlyAllowed: string;
    currentlyRefused: string;
    referenceLabel: string;
    referenceHint: string;
    /** §4.7's privacy identifier: the one a request about stored DATA can be resolved by. */
    dataIdLabel: string;
    dataIdHint: string;
  };
  footer: {
    cookieSettings: string;
  };
  privacy: {
    title: string;
    /** {store} is replaced with the store's name. */
    intro: string;
    controllersTitle: string;
    controllersBody: string;
    merchantLabel: string;
    platformLabel: string;
    contactLabel: string;
    policyLabel: string;
    measureTitle: string;
    measureItems: string[];
    neverTitle: string;
    neverItems: string[];
    retentionTitle: string;
    retentionItems: string[];
    rightsTitle: string;
    rightsBody: string;
    cookiesTitle: string;
    cookieNameHeading: string;
    cookiePurposeHeading: string;
    cookieLifeHeading: string;
    cookieConsentPurpose: string;
    cookieConsentLife: string;
    settingsCta: string;
    noDecisionYet: string;
  };
};

const en: ConsentCopy = {
  dir: "ltr",
  otherLanguageLabel: "العربية",
  banner: {
    title: "Your choice about measurement",
    // TODO(legal)
    body:
      "{store} and the platform that runs this shop would like to measure how this shop is used, " +
      "so the shop owner can see what people look for and what needs fixing. Nothing is measured " +
      "until you choose. You can change your mind at any time from Cookie settings in the footer.",
    acceptAll: "Accept all",
    reject: "Reject non-essential",
    manage: "Manage choices",
    privacyLink: "How this works",
    close: "Close",
  },
  manage: {
    title: "Manage your choices",
    intro:
      "Essential cookies keep the shop working. The other two are entirely up to you, and " +
      "refusing them changes nothing about what you can browse or buy.",
    essentialLabel: "Essential",
    essentialDescription:
      "Remembers your cart, your consent choice, and keeps checkout secure. Without these the " +
      "shop cannot function, so they are always active.",
    alwaysOn: "Always active",
    analyticsLabel: "Analytics",
    analyticsDescription:
      "Counts visits, which products are viewed, and what people search for, so the shop owner " +
      "can improve the shop. Includes Google Analytics where this shop has set it up.",
    advertisingLabel: "Advertising",
    advertisingDescription:
      "Lets this shop measure its own adverts on Google and Meta. Only active if this shop has " +
      "set those up.",
    save: "Save choices",
    acceptAll: "Accept all",
    reject: "Reject non-essential",
    withdraw: "Withdraw consent",
    currentlyAllowed: "Allowed",
    currentlyRefused: "Refused",
    referenceLabel: "Your reference",
    referenceHint:
      "Quote this if you ask us about your data. It identifies your choice, not you.",
    dataIdLabel: "Your measurement id",
    dataIdHint:
      "Quote this to ask for a copy of what this store has measured about your visits, or to " +
      "have it deleted. It is the id this store's measurement already uses for your browser.",
  },
  footer: {
    cookieSettings: "Cookie settings",
  },
  privacy: {
    title: "Privacy and measurement",
    // TODO(legal)
    intro:
      "This page explains what is measured when you browse {store}, who is responsible for it, " +
      "and how to change or undo your choice.",
    controllersTitle: "Who is responsible",
    // TODO(legal)
    controllersBody:
      "The shop owner and the platform that operates this shop are jointly responsible for " +
      "measurement here. The platform builds and runs the measurement system; the shop owner " +
      "receives and acts on their own shop's reports. The platform coordinates privacy " +
      "requests, and you may exercise your rights against either of them.",
    merchantLabel: "Shop",
    platformLabel: "Platform",
    contactLabel: "Privacy contact",
    policyLabel: "Privacy policy",
    measureTitle: "What is measured, once you agree",
    measureItems: [
      "Pages and products viewed, and items added to the cart",
      "Searches made in this shop, and searches that returned nothing",
      "Whether an order was placed, or the WhatsApp order button was used",
      "Your country, and whether you are on a phone, tablet or computer",
      "Which campaign or site brought you here, when that is visible in the link",
    ],
    neverTitle: "What is never stored",
    neverItems: [
      "Your IP address — it is used to limit abuse while the request is handled, then discarded",
      "Your full browser identification string",
      "Full addresses of pages you came from",
      "Mouse movement, scrolling or anything you type",
      "Any profile or timeline of you as an individual",
    ],
    retentionTitle: "How long it is kept",
    retentionItems: [
      "Individual events: 90 days",
      "Daily and monthly totals: up to 24 months",
      "The record of your consent choice: 24 months after it expires or changes",
      "Orders: kept as long as commercial and tax rules require",
    ],
    rightsTitle: "Your rights",
    // TODO(legal)
    rightsBody:
      "You can withdraw consent at any time, and withdrawing is as easy as giving it. You can " +
      "ask what is held about your browsing, ask for it to be deleted, or ask for it to be " +
      "separated from any order you placed. Records the law requires us to keep are kept, and " +
      "genuinely anonymous totals remain.",
    cookiesTitle: "Cookies used for measurement",
    cookieNameHeading: "Cookie",
    cookiePurposeHeading: "Purpose",
    cookieLifeHeading: "Life",
    cookieConsentPurpose:
      "Remembers the choice you made here, so you are not asked again on every page. Essential.",
    cookieConsentLife: "About 6 months",
    settingsCta: "Open cookie settings",
    noDecisionYet: "You have not made a choice yet, so nothing is being measured.",
  },
};

const ar: ConsentCopy = {
  dir: "rtl",
  otherLanguageLabel: "English",
  banner: {
    title: "قرارك بشأن القياس",
    // TODO(legal)
    body:
      "يرغب متجر {store} والمنصة التي تُشغّله في قياس طريقة استخدام هذا المتجر، حتى يعرف صاحب " +
      "المتجر ما يبحث عنه الزوار وما يحتاج إلى تحسين. لا يُقاس أي شيء قبل أن تختار، ويمكنك تغيير " +
      "قرارك في أي وقت من «إعدادات الكوكيز» في أسفل الصفحة.",
    acceptAll: "أوافق على الكل",
    reject: "أرفض غير الضروري",
    manage: "إدارة الخيارات",
    privacyLink: "كيف يعمل هذا",
    close: "إغلاق",
  },
  manage: {
    title: "إدارة خياراتك",
    intro:
      "الكوكيز الضرورية تحفظ عمل المتجر. أما الخياران الآخران فهما قرارك وحدك، ورفضهما لا يغيّر " +
      "شيئًا في قدرتك على التصفح أو الشراء.",
    essentialLabel: "ضرورية",
    essentialDescription:
      "تحفظ سلة الشراء وقرارك بشأن القياس، وتحمي صفحة إتمام الطلب. لا يعمل المتجر بدونها، لذلك " +
      "تبقى مفعّلة دائمًا.",
    alwaysOn: "مفعّلة دائمًا",
    analyticsLabel: "القياس",
    analyticsDescription:
      "يحسب الزيارات والمنتجات التي تُشاهد وما يبحث عنه الزوار، ليتمكن صاحب المتجر من تحسينه. " +
      "يشمل Google Analytics إن كان المتجر قد أعدّه.",
    advertisingLabel: "الإعلانات",
    advertisingDescription:
      "يتيح لهذا المتجر قياس إعلاناته على Google و Meta. لا يعمل إلا إذا كان المتجر قد أعدّها.",
    save: "حفظ الخيارات",
    acceptAll: "أوافق على الكل",
    reject: "أرفض غير الضروري",
    withdraw: "سحب الموافقة",
    currentlyAllowed: "مسموح",
    currentlyRefused: "مرفوض",
    referenceLabel: "رقمك المرجعي",
    referenceHint: "اذكره إذا سألتنا عن بياناتك. هو يعرّف قرارك، لا يعرّفك أنت.",
    dataIdLabel: "معرّف القياس الخاص بك",
    dataIdHint:
      "اذكره لطلب نسخة من بيانات زياراتك التي قاسها هذا المتجر، أو لحذفها. هو المعرّف الذي يستخدمه القياس لمتصفحك أصلاً.",
  },
  footer: {
    cookieSettings: "إعدادات الكوكيز",
  },
  privacy: {
    title: "الخصوصية والقياس",
    // TODO(legal)
    intro:
      "توضح هذه الصفحة ما يُقاس أثناء تصفحك متجر {store}، ومن المسؤول عن ذلك، وكيف تغيّر قرارك " +
      "أو تلغيه.",
    controllersTitle: "من المسؤول",
    // TODO(legal)
    controllersBody:
      "صاحب المتجر والمنصة التي تُشغّل هذا المتجر مسؤولان معًا عن القياس هنا. المنصة تبني نظام " +
      "القياس وتُشغّله، وصاحب المتجر يتلقى تقارير متجره ويتصرف على أساسها. تنسّق المنصة طلبات " +
      "الخصوصية، ويمكنك ممارسة حقوقك تجاه أي منهما.",
    merchantLabel: "المتجر",
    platformLabel: "المنصة",
    contactLabel: "جهة التواصل للخصوصية",
    policyLabel: "سياسة الخصوصية",
    measureTitle: "ما يُقاس بعد موافقتك",
    measureItems: [
      "الصفحات والمنتجات التي تُشاهدها، وما يُضاف إلى السلة",
      "ما تبحث عنه في هذا المتجر، والبحث الذي لا يُرجع نتائج",
      "ما إذا تم تقديم طلب، أو استُخدم زر الطلب عبر واتساب",
      "بلدك، وما إذا كنت تستخدم هاتفًا أو لوحًا أو حاسوبًا",
      "الحملة أو الموقع الذي أتى بك إلى هنا، إذا كان ظاهرًا في الرابط",
    ],
    neverTitle: "ما لا يُحفظ أبدًا",
    neverItems: [
      "عنوان IP الخاص بك — يُستخدم للحد من إساءة الاستخدام أثناء معالجة الطلب ثم يُهمل",
      "النص الكامل الذي يعرّف متصفحك",
      "العناوين الكاملة للصفحات التي أتيت منها",
      "حركة المؤشر أو التمرير أو أي شيء تكتبه",
      "أي ملف تعريف أو سجل زمني يخصك كفرد",
    ],
    retentionTitle: "مدة الحفظ",
    retentionItems: [
      "الأحداث الفردية: ٩٠ يومًا",
      "المجاميع اليومية والشهرية: حتى ٢٤ شهرًا",
      "سجل موافقتك: ٢٤ شهرًا بعد انتهائها أو تغيّرها",
      "الطلبات: تُحفظ بالمدة التي تفرضها القواعد التجارية والضريبية",
    ],
    rightsTitle: "حقوقك",
    // TODO(legal)
    rightsBody:
      "يمكنك سحب موافقتك في أي وقت، والسحب بالسهولة نفسها التي مُنحت بها. ويمكنك أن تسأل عمّا هو " +
      "محفوظ عن تصفحك، أو تطلب حذفه، أو تطلب فصله عن أي طلب قدّمته. أما السجلات التي يُلزمنا " +
      "القانون بحفظها فتبقى محفوظة، وتبقى كذلك المجاميع المجهولة فعليًا.",
    cookiesTitle: "الكوكيز المستخدمة للقياس",
    cookieNameHeading: "الكوكي",
    cookiePurposeHeading: "الغرض",
    cookieLifeHeading: "المدة",
    cookieConsentPurpose: "يحفظ قرارك هنا حتى لا تُسأل مرة أخرى في كل صفحة. ضروري.",
    cookieConsentLife: "نحو ٦ أشهر",
    settingsCta: "فتح إعدادات الكوكيز",
    noDecisionYet: "لم تختر بعد، لذلك لا يُقاس أي شيء.",
  },
};

export const CONSENT_COPY: Record<ConsentLocale, ConsentCopy> = { en, ar };

export const consentCopy = (locale: ConsentLocale): ConsentCopy => CONSENT_COPY[locale];

/** Replaces {store} (and any other single-brace token passed in) without touching the rest. */
export function fillConsentTokens(text: string, tokens: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => tokens[key] ?? match);
}

/**
 * What a store is allowed to know about what a shopper typed (§3.6, D22, D31, D32).
 *
 * A search box is the one place on a storefront where a visitor types free text, which makes it
 * the one place that can collect something nobody meant to collect: a phone number pasted into
 * the wrong field, an email, a card number. The raw text is therefore NEVER stored. It arrives,
 * is normalized and inspected here, and only the result reaches the database.
 *
 * Two jobs, in this order, because the order is what makes the second one work:
 *
 *  1. **Normalize**, so one word spelled several ordinary ways is one phrase. For Arabic that is
 *     not a nicety: أ إ آ ا are the same letter to a shopper, ة and ه end the same word, ى and ي
 *     are typed interchangeably, and a keyboard may produce Arabic-Indic digits. Without this, a
 *     store whose shoppers type Arabic — most stores here — gets its search report split across
 *     spellings of the same search, and the "what should I stock" question it exists to answer
 *     cannot be answered.
 *
 *  2. **Redact**, if what is left looks like personal data. Digits are folded to ASCII in step 1
 *     precisely so this step can be written once: an ASCII-only pattern cannot see ٠٣ ١٢٣ ٤٥٦,
 *     and a scrub that misses the local way of writing a phone number is theatre.
 *
 * A redacted phrase is still counted — a search happened, and hiding that would understate every
 * total — but it is excluded from anything that suggests what to stock, because "[redacted]" is
 * not a product and whoever typed it was not shopping.
 *
 * Pure: no database, no env, no node built-ins. The same function runs in a check and in
 * ingestion, so what a test proves is what production does.
 */

/** Longest phrase kept. Longer searches are sentences, and they group with nothing. */
export const MAX_SEARCH_PHRASE = 80;

export const REDACTED = "[redacted]";

/** A run this long of digits is a number about a person, not a product. See `looksSensitive`. */
const SENSITIVE_DIGIT_RUN = 6;

const ARABIC_INDIC_DIGITS = /[٠-٩]/g; // ٠١٢٣٤٥٦٧٨٩
const EXTENDED_ARABIC_INDIC_DIGITS = /[۰-۹]/g; // ۰۱۲۳۴۵۶۷۸۹
/** Harakat and the other marks that ride above or below a letter without changing the word. */
const TASHKEEL = /[ً-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g; // ـ, used to stretch a word for looks: "كـــتاب" is "كتاب"
const ALEF_FORMS = /[آأإٱ]/g; // آ أ إ ٱ
const TA_MARBUTA = /ة/g; // ة
const ALEF_MAKSURA = /ى/g; // ى

/** Separators people put inside numbers, and which must not hide one from the scrub. */
const NUMBER_SEPARATORS = /[\s\-().‐-―/\\_+]/g;

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

/**
 * Fold the two Arabic digit sets to ASCII.
 *
 * Exported because the PII patterns depend on it having happened: `looksSensitive` is written in
 * ASCII digits only, and a caller that skips this step would get a pass on a phone number that
 * is perfectly readable to a human.
 */
export function foldDigits(text: string): string {
  return text
    .replace(ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(EXTENDED_ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Arabic spelling variants that mean the same word (D31). */
export function foldArabic(text: string): string {
  return text
    .replace(TASHKEEL, "")
    .replace(TATWEEL, "")
    .replace(ALEF_FORMS, "ا")
    .replace(TA_MARBUTA, "ه")
    .replace(ALEF_MAKSURA, "ي");
}

/**
 * Whether a normalized phrase looks like somebody's personal data (D22, D32).
 *
 * Deliberately blunt about digits. Six consecutive digits covers a Lebanese local number
 * (7–8), an international one with +961 or 00961 (10–11), and a card (13–19), and the cost of
 * being wrong is asymmetric: over-redacting "12345678" loses one meaningless search phrase,
 * while under-redacting it writes a shopper's phone number into a merchant's report.
 *
 * Expects digits already folded by `foldDigits`.
 */
export function looksSensitive(text: string): boolean {
  if (EMAIL.test(text)) return true;
  // Strip the separators a person writes inside a number — "+961 3 123 456", "03/123456" and
  // "03-123-456" are one number each, and must not be read as a handful of short runs.
  const joined = text.replace(NUMBER_SEPARATORS, "");
  return new RegExp(`\\d{${SENSITIVE_DIGIT_RUN},}`).test(joined);
}

export type NormalizedSearch = {
  /** What gets stored: a grouped phrase, or exactly `[redacted]`. Empty means "store nothing". */
  phrase: string;
  /** True when the phrase was replaced. Kept on the row so reports can count it and still
   * exclude it from stocking suggestions. */
  redacted: boolean;
};

/**
 * The one function ingestion calls. Everything a store ever sees of a search comes out of here.
 */
export function normalizeSearchText(raw: string | null | undefined): NormalizedSearch {
  if (!raw) return { phrase: "", redacted: false };

  // Unicode-normalize first (NFC), so a letter typed as a base plus a combining mark is the
  // same letter as its precomposed form before anything below looks at it.
  let text = raw.normalize("NFC");
  text = foldDigits(text);
  text = foldArabic(text);
  text = text.replace(/\s+/g, " ").trim().toLowerCase();

  if (!text) return { phrase: "", redacted: false };
  // Redact the WHOLE value, not the matching part: a partially masked string is still a
  // person's details, and "ahmad@" plus a domain is not meaningfully less identifying.
  if (looksSensitive(text)) return { phrase: REDACTED, redacted: true };

  return { phrase: text.slice(0, MAX_SEARCH_PHRASE), redacted: false };
}

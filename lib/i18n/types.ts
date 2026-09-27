import type { DictionaryKey } from "./dictionaries/en";

export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Separator for encoding an interpolated message as a raw string: "<key><SEP><param0><SEP>...".
 * A control character (never typed by a user, never rendered) rather than "|" — a category or
 * attribute name the owner types could itself legitimately contain "|", which would corrupt a
 * "|"-delimited encoding. Lives here (not context.tsx) so plain shared modules like
 * lib/validation.ts and lib/variants.ts — imported by client components too — can build these
 * strings without importing the client-only LocaleProvider/useT machinery.
 */
export const MSG_SEP = "\u0001";

/** Builds a resolveMessage()-ready raw string from a key and its positional params. */
export function encodeMessage(key: DictionaryKey, ...params: (string | number)[]): string {
  return [key, ...params].join(MSG_SEP);
}

/**
 * Resolves a plain key or an encodeMessage()-built raw string, filling in {0}, {1}...
 * Lives here (not context.tsx, which is "use client") so Server Components can call it directly
 * — a "use client" module's exports can only be rendered as JSX or passed as props from a Server
 * Component, never invoked as a plain function.
 */
export function resolveMessage(t: (key: DictionaryKey) => string, raw: string): string {
  const [key, ...params] = raw.split(MSG_SEP);
  return params.reduce((s, p, i) => s.replaceAll(`{${i}}`, p), t(key as DictionaryKey));
}

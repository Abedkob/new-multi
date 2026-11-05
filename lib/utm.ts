/**
 * How a utm value is normalized, in one place.
 *
 * Pure, and reachable from a client bundle: the link builder normalizes as the owner types, the
 * server normalizes again when a campaign is saved, and the two have to agree exactly. A saved
 * row whose `utmCampaign` differs by one character from the value the link carries never joins
 * to its own traffic — the Campaigns tab would show the campaign twice, once with the owner's
 * name and no numbers and once with the raw utm value and all of them. Two copies of this
 * function is how that happens, so there is one.
 *
 * The report compares utm values as plain strings (lib/analytics/aggregate.ts groups by them),
 * which is why this is lossy on purpose: lower-cased, non-alphanumerics collapsed to a single
 * dash, trimmed of dashes, and capped at 60 characters.
 */
export const slugifyUtm = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

export const ADMIN_PAGE_SIZES = [25, 50, 75] as const;

export type AdminPageSize = (typeof ADMIN_PAGE_SIZES)[number];

export function normalizeAdminPageSize(value: number): AdminPageSize {
  return ADMIN_PAGE_SIZES.find((size) => size === value) ?? ADMIN_PAGE_SIZES[0];
}

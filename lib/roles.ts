export type Role = "PLATFORM_ADMIN" | "STORE_OWNER" | "STAFF";

/** The two roles that live inside one store, and are therefore scoped by a tenant (D71). */
export type AdminRole = "STORE_OWNER" | "STAFF";

export const isAdminRole = (role: Role | undefined): role is AdminRole =>
  role === "STORE_OWNER" || role === "STAFF";

/**
 * Where a role lands after login.
 *
 * Staff go to Orders rather than `/admin`, because `/admin` is the dashboard and the dashboard
 * is analytics — which staff are not allowed to see (D73). Sending them to a page they would be
 * refused is how a login turns into a redirect loop.
 */
export function homeForRole(role: Role | undefined) {
  if (role === "PLATFORM_ADMIN") return "/platform";
  if (role === "STAFF") return "/admin/orders";
  return "/admin";
}

/** Claims we store in the Auth.js JWT (the JWT type itself is loosely typed). */
export type AppClaims = {
  userId: string;
  role: Role;
  /**
   * The store this session acts within: the owned tenant for an owner, the employing tenant for
   * staff, null for a platform admin. Still only ever a hint — `lib/session.ts` re-reads it from
   * the database on every render and action, and that value is the one the data layer gets.
   */
  tenantId: string | null;
  mustChangePassword: boolean;
  /** User.sessionVersion at login; absent on tokens issued before the column existed (= 0). */
  sessionVersion?: number;
};

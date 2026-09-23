export type Role = "PLATFORM_ADMIN" | "STORE_OWNER";

export function homeForRole(role: Role | undefined) {
  return role === "PLATFORM_ADMIN" ? "/platform" : "/admin";
}

/** Claims we store in the Auth.js JWT (the JWT type itself is loosely typed). */
export type AppClaims = {
  userId: string;
  role: Role;
  tenantId: string | null;
  mustChangePassword: boolean;
  /** User.sessionVersion at login; absent on tokens issued before the column existed (= 0). */
  sessionVersion?: number;
};

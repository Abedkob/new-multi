export type LicenseAccessSnapshot = {
  status: string;
  expiresAt: Date | null;
  offlineGraceUntil: Date | null;
};

/** A missing license is allowed during the opt-in rollout; configured licenses fail closed. */
export function isLicenseActive(license: LicenseAccessSnapshot | null | undefined, now = new Date()) {
  if (!license) return true;
  if (license.status !== "LICENSE_ACTIVE") return false;
  if (license.expiresAt && license.expiresAt.getTime() <= now.getTime()) return false;
  if (license.offlineGraceUntil && license.offlineGraceUntil.getTime() < now.getTime()) return false;
  return true;
}

export function canServeTenant(tenant: {
  isPaused: boolean;
  license?: LicenseAccessSnapshot | null;
}, now = new Date()) {
  return !tenant.isPaused && isLicenseActive(tenant.license, now);
}

import { Prisma } from "@/generated/prisma/client";
import { withBypass } from "@/lib/prisma";
import type { LicenseProviderSnapshot } from "@/lib/license/provider";
import { dateFromProvider } from "@/lib/license/provider";

export function savePendingTenantLicense(input: {
  tenantId: string;
  productCode: string;
  keyCiphertext: string;
  keyHint: string;
}) {
  return withBypass((db) =>
    db.tenantLicense.upsert({
      where: { tenantId: input.tenantId },
      create: {
        tenantId: input.tenantId,
        productCode: input.productCode,
        licenseKeyCiphertext: input.keyCiphertext,
        keyHint: input.keyHint,
        status: "PENDING",
      },
      update: {
        productCode: input.productCode,
        licenseKeyCiphertext: input.keyCiphertext,
        keyHint: input.keyHint,
        activationTokenCiphertext: null,
        status: "PENDING",
        providerRequestId: null,
        activationId: null,
        licenseType: null,
        expiresAt: null,
        entitlements: Prisma.DbNull,
        checkAfter: null,
        offlineGraceUntil: null,
        lastCheckedAt: null,
        lastError: null,
      },
      select: { id: true, installationId: true },
    }),
  );
}

export async function saveProviderSnapshot(input: {
  id: string;
  snapshot: LicenseProviderSnapshot;
  activationTokenCiphertext?: string;
  error?: string | null;
  lastCheckedAt?: Date;
  retryAt?: Date;
}) {
  const { snapshot } = input;
  const checkedAt = input.lastCheckedAt ?? new Date();
  const active = snapshot.ok && snapshot.code === "LICENSE_ACTIVE";
  const scheduledCheckAfter = snapshot.check_after === undefined || snapshot.check_after === null
    ? active ? new Date(checkedAt.getTime() + 24 * 60 * 60_000) : undefined
    : dateFromProvider(snapshot.check_after);
  const offlineGraceUntil = snapshot.offline_grace_until === undefined || snapshot.offline_grace_until === null
    ? active ? scheduledCheckAfter ?? checkedAt : undefined
    : dateFromProvider(snapshot.offline_grace_until);
  const entitlements = snapshot.entitlements === undefined
    ? undefined
    : snapshot.entitlements === null
      ? Prisma.DbNull
      : (JSON.parse(JSON.stringify(snapshot.entitlements)) as Prisma.InputJsonValue);
  return withBypass((db) =>
    db.tenantLicense.update({
      where: { id: input.id },
      data: {
        status: snapshot.ok ? snapshot.code : snapshot.code || "PROVIDER_REJECTED",
        providerRequestId: snapshot.request_id ?? undefined,
        activationId: snapshot.activation_id ?? undefined,
        licenseType: snapshot.license_type ?? undefined,
        expiresAt: snapshot.expires_at === undefined ? undefined : dateFromProvider(snapshot.expires_at),
        entitlements,
        checkAfter: input.retryAt ?? scheduledCheckAfter,
        offlineGraceUntil,
        lastCheckedAt: checkedAt,
        lastError: input.error ?? (snapshot.ok && snapshot.code === "LICENSE_ACTIVE" ? null : snapshot.code),
        ...(input.activationTokenCiphertext
          ? { activationTokenCiphertext: input.activationTokenCiphertext }
          : {}),
      },
    }),
  );
}

export function listDueTenantLicenses(now: Date) {
  return withBypass((db) =>
    db.tenantLicense.findMany({
      where: {
        activationTokenCiphertext: { not: null },
        checkAfter: { lte: now },
      },
      select: {
        id: true,
        installationId: true,
        activationTokenCiphertext: true,
      },
      take: 100,
      orderBy: { checkAfter: "asc" },
    }),
  );
}

export function recordHeartbeatFailure(id: string, retryAt: Date) {
  return withBypass((db) =>
    db.tenantLicense.update({
      where: { id },
      data: { lastCheckedAt: new Date(), checkAfter: retryAt, lastError: "PROVIDER_UNAVAILABLE" },
      select: { id: true },
    }),
  );
}

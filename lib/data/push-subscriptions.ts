/**
 * Registered devices (§9.6, §11.2).
 *
 * `withBypass` throughout, for two reasons that are easy to get wrong:
 *
 *   - A PLATFORM subscription has no `tenantId`, so no tenant policy can ever see it.
 *   - The scheduled job sweeps expired endpoints across every store with no tenant context.
 *
 * The policy still does its work — `verify:isolation` proves one store cannot read or plant
 * another's devices — but the *application* reads are keyed by user, which is the right key:
 * a device belongs to a person, and removing it must not depend on which store they were
 * looking at.
 */

import type { NotificationAudience } from "@/generated/prisma/client";
import { withBypass } from "@/lib/prisma";
import { encryptPushSecret, endpointHash, pushSecretsAvailable } from "@/lib/push/crypto";

export type DeviceSummary = {
  id: string;
  deviceLabel: string;
  deviceClass: string;
  createdAt: Date;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  expiredAt: Date | null;
};

export type RegisterInput = {
  userId: string;
  tenantId: string | null;
  audience: NotificationAudience;
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel: string;
  deviceClass: string;
};

export class PushUnavailable extends Error {}

/**
 * Register a device, or refresh the one that already exists.
 *
 * An upsert on the endpoint hash, because a browser re-subscribing hands back the same endpoint
 * and an insert would leave the owner looking at the same phone listed four times. Re-registering
 * also clears `expiredAt`: a device that the push service once called gone and that is now
 * subscribing again is alive, and treating it as dead would silently stop its notifications.
 */
export async function registerDevice(input: RegisterInput): Promise<{ id: string }> {
  if (!pushSecretsAvailable()) {
    throw new PushUnavailable("PUSH_ENCRYPTION_KEY is not set: a device cannot be stored");
  }
  const hash = endpointHash(input.endpoint);
  return withBypass(async (db) => {
    const row = await db.pushSubscription.upsert({
      where: { endpointHash: hash },
      create: {
        userId: input.userId,
        tenantId: input.tenantId,
        audience: input.audience,
        endpointCiphertext: encryptPushSecret(input.endpoint),
        endpointHash: hash,
        p256dhCiphertext: encryptPushSecret(input.p256dh),
        authCiphertext: encryptPushSecret(input.auth),
        deviceLabel: input.deviceLabel.slice(0, 80),
        deviceClass: input.deviceClass.slice(0, 40),
      },
      update: {
        // The keys rotate when a browser re-subscribes, so they are refreshed too — a stale
        // p256dh means every payload is encrypted to a key the device no longer holds.
        p256dhCiphertext: encryptPushSecret(input.p256dh),
        authCiphertext: encryptPushSecret(input.auth),
        deviceLabel: input.deviceLabel.slice(0, 80),
        deviceClass: input.deviceClass.slice(0, 40),
        userId: input.userId,
        tenantId: input.tenantId,
        audience: input.audience,
        revokedAt: null,
        expiredAt: null,
      },
      select: { id: true },
    });
    return row;
  });
}

/** The devices this person can see in their own list: live ones, newest first. */
export function listDevices(userId: string, audience: NotificationAudience): Promise<DeviceSummary[]> {
  return withBypass((db) =>
    db.pushSubscription.findMany({
      where: { userId, audience, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        deviceLabel: true,
        deviceClass: true,
        createdAt: true,
        lastSuccessAt: true,
        lastFailureAt: true,
        expiredAt: true,
      },
    }),
  );
}

/**
 * Remove one device, and only if it is this person's.
 *
 * Revoked rather than deleted: a delivery row points at it, and the ledger's account of what
 * was sent last month must not lose the name of the device it went to. §11.2's rule also lives
 * here — removing a device changes no preference and touches no other device.
 */
export async function revokeDevice(userId: string, deviceId: string): Promise<boolean> {
  const updated = await withBypass((db) =>
    db.pushSubscription.updateMany({
      where: { id: deviceId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  );
  return updated.count === 1;
}

/** The push service said this endpoint is gone for good. Never retried after this. */
export function markDeviceExpired(subscriptionId: string): Promise<void> {
  return withBypass(async (db) => {
    await db.pushSubscription.updateMany({
      where: { id: subscriptionId },
      data: { expiredAt: new Date(), lastFailureAt: new Date() },
    });
  });
}

export function recordDeviceSuccess(subscriptionId: string): Promise<void> {
  return withBypass(async (db) => {
    await db.pushSubscription.updateMany({
      where: { id: subscriptionId },
      data: { lastSuccessAt: new Date(), lastFailureAt: null },
    });
  });
}

export function recordDeviceFailure(subscriptionId: string): Promise<void> {
  return withBypass(async (db) => {
    await db.pushSubscription.updateMany({
      where: { id: subscriptionId },
      data: { lastFailureAt: new Date() },
    });
  });
}

/** What a sender needs: the decrypted target for every live device of one recipient. */
export function sendableDevices(userId: string, audience: NotificationAudience) {
  return withBypass((db) =>
    db.pushSubscription.findMany({
      where: { userId, audience, revokedAt: null, expiredAt: null },
      select: {
        id: true,
        endpointCiphertext: true,
        p256dhCiphertext: true,
        authCiphertext: true,
      },
    }),
  );
}

/** Revoked or permanently expired devices, for the scheduled cleanup stage (§10). */
export function listDeadDevices(before: Date, take = 500) {
  return withBypass((db) =>
    db.pushSubscription.findMany({
      where: {
        OR: [{ revokedAt: { lt: before } }, { expiredAt: { lt: before } }],
      },
      select: { id: true },
      take,
    }),
  );
}

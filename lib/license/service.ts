import { env } from "@/lib/env";
import { decryptLicenseSecret, encryptLicenseSecret } from "@/lib/license/crypto";
import { activateLicense, heartbeatLicense } from "@/lib/license/provider";
import {
  listDueTenantLicenses,
  recordHeartbeatFailure,
  savePendingTenantLicense,
  saveProviderSnapshot,
} from "@/lib/data/licenses";

const ACTIVE_CODE = "LICENSE_ACTIVE";
const MIN_TOKEN_LENGTH = 20;

export async function activateTenantLicense(tenantId: string, licenseKey: string) {
  const key = licenseKey.trim();
  const row = await savePendingTenantLicense({
    tenantId,
    productCode: env.LICENSE_PRODUCT_CODE,
    keyCiphertext: encryptLicenseSecret(key),
    keyHint: key.slice(-6),
  });

  try {
    const snapshot = await activateLicense({ licenseKey: key, installationId: row.installationId });
    if (snapshot.product_code && snapshot.product_code !== env.LICENSE_PRODUCT_CODE) {
      await saveProviderSnapshot({
        id: row.id,
        snapshot: { ...snapshot, ok: false, code: "PRODUCT_CODE_MISMATCH" },
        error: "PRODUCT_CODE_MISMATCH",
      });
      return { ok: false as const, message: "The license provider returned a different product code." };
    }
    if (snapshot.ok && snapshot.code === ACTIVE_CODE) {
      if (!snapshot.activation_token || snapshot.activation_token.length < MIN_TOKEN_LENGTH) {
        await saveProviderSnapshot({
          id: row.id,
          snapshot: { ...snapshot, ok: false, code: "ACTIVATION_TOKEN_MISSING" },
          error: "ACTIVATION_TOKEN_MISSING",
        });
        return { ok: false as const, message: "The provider accepted the license but did not return a valid activation token." };
      }
      await saveProviderSnapshot({
        id: row.id,
        snapshot,
        activationTokenCiphertext: encryptLicenseSecret(snapshot.activation_token),
      });
      return { ok: true as const, message: "License activated." };
    }

    await saveProviderSnapshot({ id: row.id, snapshot, error: snapshot.code });
    return { ok: false as const, message: `The license provider returned ${snapshot.code}.` };
  } catch {
    await saveProviderSnapshot({
      id: row.id,
      snapshot: { ok: false, code: "PROVIDER_UNAVAILABLE" },
      error: "PROVIDER_UNAVAILABLE",
    });
    return { ok: false as const, message: "Couldn't reach the license service. The encrypted key was saved; submit it again to retry." };
  }
}

export async function heartbeatDueTenantLicenses() {
  const due = await listDueTenantLicenses(new Date());
  const summary = { checked: 0, active: 0, rejected: 0, unavailable: 0 };

  // Bound concurrency so a backlog clears quickly without sending a burst of 100 calls to the provider.
  for (let i = 0; i < due.length; i += 5) {
    const batch = due.slice(i, i + 5);
    const outcomes = await Promise.all(batch.map(async (license) => {
      try {
        const token = decryptLicenseSecret(license.activationTokenCiphertext!);
        const snapshot = await heartbeatLicense({
          installationId: license.installationId,
          activationToken: token,
        });
        if (snapshot.product_code && snapshot.product_code !== env.LICENSE_PRODUCT_CODE) {
          await saveProviderSnapshot({
            id: license.id,
            snapshot: { ...snapshot, ok: false, code: "PRODUCT_CODE_MISMATCH" },
            error: "PRODUCT_CODE_MISMATCH",
          });
          return "rejected" as const;
        }
        let tokenCiphertext: string | undefined;
        if (snapshot.activation_token) {
          if (snapshot.activation_token.length < MIN_TOKEN_LENGTH) {
            throw new Error("Provider returned a malformed activation token.");
          }
          tokenCiphertext = encryptLicenseSecret(snapshot.activation_token);
        }
        await saveProviderSnapshot({
          id: license.id,
          snapshot,
          activationTokenCiphertext: tokenCiphertext,
        });
        return snapshot.ok && snapshot.code === ACTIVE_CODE ? "active" as const : "rejected" as const;
      } catch {
        await recordHeartbeatFailure(license.id, new Date(Date.now() + 10 * 60_000));
        return "unavailable" as const;
      }
    }));
    summary.checked += outcomes.length;
    for (const outcome of outcomes) summary[outcome]++;
  }

  return summary;
}

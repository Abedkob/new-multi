import { z } from "zod";
import { env } from "@/lib/env";

const providerResponseSchema = z.object({
  ok: z.boolean(),
  code: z.string().min(1),
  request_id: z.string().optional(),
  activation_id: z.string().optional(),
  product_code: z.string().optional(),
  license_type: z.string().optional(),
  expires_at: z.string().nullable().optional(),
  entitlements: z.record(z.string(), z.unknown()).nullable().optional(),
  activation_token: z.string().nullable().optional(),
  check_after: z.string().nullable().optional(),
  offline_grace_until: z.string().nullable().optional(),
  message: z.string().optional(),
}).passthrough();

export type LicenseProviderSnapshot = z.infer<typeof providerResponseSchema>;

function endpoint(path: "activate" | "heartbeat") {
  return `${env.LICENSE_API_BASE_URL.replace(/\/+$/, "")}/v1/licenses/${path}`;
}

async function post(
  path: "activate" | "heartbeat",
  body: Record<string, string>,
  activationToken?: string,
): Promise<LicenseProviderSnapshot> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (activationToken) headers.Authorization = `Bearer ${activationToken}`;

  const response = await fetch(endpoint(path), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(env.LICENSE_API_TIMEOUT_MS),
    cache: "no-store",
  });
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new Error(`License provider returned invalid JSON (HTTP ${response.status}).`);
  }
  const parsed = providerResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`License provider returned an invalid response (HTTP ${response.status}).`);
  if (!response.ok && parsed.data.ok) {
    return { ...parsed.data, ok: false, code: `HTTP_${response.status}` };
  }
  return parsed.data;
}

export function activateLicense(input: {
  licenseKey: string;
  installationId: string;
}): Promise<LicenseProviderSnapshot> {
  return post("activate", {
    license_key: input.licenseKey,
    product_code: env.LICENSE_PRODUCT_CODE,
    installation_id: input.installationId,
    application_version: env.LICENSE_APPLICATION_VERSION,
    platform: env.LICENSE_PLATFORM,
  });
}

export function heartbeatLicense(input: {
  installationId: string;
  activationToken: string;
}): Promise<LicenseProviderSnapshot> {
  return post(
    "heartbeat",
    {
      installation_id: input.installationId,
      product_code: env.LICENSE_PRODUCT_CODE,
      application_version: env.LICENSE_APPLICATION_VERSION,
      platform: env.LICENSE_PLATFORM,
    },
    input.activationToken,
  );
}

export function dateFromProvider(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { heartbeatDueTenantLicenses } from "@/lib/license/service";

export const dynamic = "force-dynamic";

function isAuthorized(request: Request) {
  const secret = env.LICENSE_HEARTBEAT_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!secret || !supplied) return false;
  const expectedBytes = Buffer.from(secret);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function POST(request: Request) {
  if (!env.LICENSE_HEARTBEAT_SECRET) {
    return NextResponse.json({ error: "Heartbeat scheduling is not configured." }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await heartbeatDueTenantLicenses();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

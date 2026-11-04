import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { snapshotAnalyticsHealth } from "@/lib/analytics/health";
import { analyticsDropCount } from "@/lib/prisma-analytics";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * The ingestion counters for THIS process (§11.10).
 *
 * Dropped batches leave no row anywhere — that is the point of dropping them — so the only
 * record is in memory, and something has to be able to read it. Phase 4's scheduled flush and
 * Phase 6's health alert both need this, and so does anyone asking "we lost 14% of events last
 * night, to what?". Without it the honest answer is a shrug.
 *
 * Authenticated with the same shared secret as the licence heartbeat: internal, server to
 * server, never reachable from a storefront. It exposes counts only — no tenant data, no
 * identifiers, nothing about any visitor.
 *
 * `?reset=1` starts a fresh window, which is what the scheduled flush will use so consecutive
 * windows do not overlap. Counters are per process, so with several instances each reports its
 * own and the aggregate is the caller's job.
 */

function authorized(request: Request) {
  const secret = env.LICENSE_HEARTBEAT_SECRET;
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!secret || !supplied) return false;
  const expected = Buffer.from(secret);
  const given = Buffer.from(supplied);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function GET(request: Request) {
  if (!env.LICENSE_HEARTBEAT_SECRET) {
    return NextResponse.json({ error: "Not configured." }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const reset = new URL(request.url).searchParams.get("reset") === "1";
  return NextResponse.json(
    { ...snapshotAnalyticsHealth(reset), concurrencyDrops: analyticsDropCount() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

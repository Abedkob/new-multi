/**
 * The edge: what this origin believes about a request, and under which configuration (D75, D83).
 *
 *   pnpm verify:edge
 *
 * Static. No server, no database, no browser — and that is a deliberate boundary rather than a
 * convenience. What this script covers is the half of D75 that lives in this repository: the
 * trust gate in `lib/edge.ts`, the single chokepoint in front of `countryFrom`, the headers that
 * are dropped from an untrusted request, the https upgrade, and the rule that HSTS is absent in
 * every committed configuration.
 *
 * **What it does not cover, and does not claim to:** the live edge. P7-12 to P7-16 — http→https
 * at the edge, a `Secure` cookie surviving a round trip on a custom domain, a forged
 * `cf-ipcountry` refused by the real origin, the tracker accepted on a custom domain, HSTS
 * present only once enabled — need the real domain and run at the pilot. An assertion that can
 * only pass when an environment happens to be configured is not a check; EDGE_HARDENING.md §6
 * names them and gives the curl commands.
 *
 * Every function under test takes its configuration explicitly (see lib/edge.ts's docstring), so
 * all four modes are exercised in this one process instead of one process per mode.
 */

import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EDGE_IDENTITY_HEADERS,
  EDGE_TOKEN_HEADER,
  countryFromTrusted,
  httpsRedirectUrl,
  isTrustedEdgeRequest,
  sanitizeEdgeHeaders,
  securityHeaders,
  trustedClientIp,
  type EdgeConfig,
} from "../lib/edge";
import { clientIp } from "../lib/rate-limit";
import { envSchema } from "../lib/env";

let checks = 0;
let failures = 0;

function check(label: string, detail: string, fn: () => void) {
  try {
    fn();
    checks += 1;
    console.log(`  ok   ${label.padEnd(14)} ${detail}`);
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.error(`  FAIL ${label.padEnd(14)} ${detail}\n       ${message}`);
  }
}

const SECRET = "e".repeat(64);

const OFF: EdgeConfig = { mode: "off", forceHttps: false, hstsMaxAge: 0 };
const LOCKED: EdgeConfig = { mode: "cloudflare", secret: SECRET, forceHttps: false, hstsMaxAge: 0 };

/** A request as it arrives from a client that found the origin directly. */
const forged = (extra: Record<string, string> = {}) =>
  new Headers({
    "cf-ipcountry": "FR",
    "cf-connecting-ip": "203.0.113.9",
    "x-forwarded-for": "9.9.9.9",
    "user-agent": "curl/8.0",
    ...extra,
  });

console.log("\nEdge trust and hardening\n");

// ------------------------------------------------------------------ the trust gate
check("trust-off", "with no edge declared, every request is believed (pre-Phase-7 behaviour)", () => {
  assert.equal(isTrustedEdgeRequest(forged(), OFF), true);
  assert.equal(countryFromTrusted(forged(), OFF), "FR");
});

check("trust-deny", "in cloudflare mode a request with no token is refused, and has no country", () => {
  assert.equal(isTrustedEdgeRequest(forged(), LOCKED), false);
  assert.equal(countryFromTrusted(forged(), LOCKED), null);
});

check("trust-allow", "the edge's own token is believed, country and all", () => {
  const headers = forged({ [EDGE_TOKEN_HEADER]: SECRET });
  assert.equal(isTrustedEdgeRequest(headers, LOCKED), true);
  assert.equal(countryFromTrusted(headers, LOCKED), "FR");
});

check("trust-wrong", "a wrong token is refused, including a prefix of the real one", () => {
  assert.equal(isTrustedEdgeRequest(forged({ [EDGE_TOKEN_HEADER]: "wrong" }), LOCKED), false);
  assert.equal(
    isTrustedEdgeRequest(forged({ [EDGE_TOKEN_HEADER]: SECRET.slice(0, 32) }), LOCKED),
    false,
  );
  // A mode with no secret trusts nothing rather than everything. lib/env.ts refuses to boot in
  // this state; this is the behaviour if it ever gets there anyway.
  assert.equal(isTrustedEdgeRequest(forged({ [EDGE_TOKEN_HEADER]: SECRET }), {
    ...LOCKED,
    secret: undefined,
  }), false);
});

// ------------------------------------------------------------------ the strip
check("strip-untrusted", "an untrusted request loses every edge header on its way in", () => {
  const sanitized = sanitizeEdgeHeaders(forged(), LOCKED);
  for (const name of EDGE_IDENTITY_HEADERS) {
    assert.equal(sanitized.get(name), null, `${name} survived the strip`);
  }
  // Not stripped, on purpose — see EDGE_IDENTITY_HEADERS' docstring.
  assert.equal(sanitized.get("x-forwarded-for"), "9.9.9.9");
  assert.equal(sanitized.get("user-agent"), "curl/8.0");
});

check("strip-trusted", "a request from the edge keeps what the edge wrote", () => {
  const sanitized = sanitizeEdgeHeaders(forged({ [EDGE_TOKEN_HEADER]: SECRET }), LOCKED);
  assert.equal(sanitized.get("cf-ipcountry"), "FR");
  assert.equal(sanitized.get("cf-connecting-ip"), "203.0.113.9");
});

// ------------------------------------------------------------------ the list cannot fall behind
check("strip-covers", "every header the country reader looks at is in the strip list", () => {
  const source = readFileSync("lib/analytics/request.ts", "utf8");
  const declared = source.match(/const COUNTRY_HEADERS = \[([^\]]*)\]/)?.[1];
  assert.ok(declared, "could not find COUNTRY_HEADERS in lib/analytics/request.ts");
  const names = [...declared.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(names.length >= 3, `expected the country header list, got ${JSON.stringify(names)}`);
  for (const name of names) {
    assert.ok(
      (EDGE_IDENTITY_HEADERS as readonly string[]).includes(name),
      `${name} is read as a country but is not stripped from an untrusted request`,
    );
  }
});

// ------------------------------------------------------------------ one gate, not one per reader
check("chokepoint", "nothing outside lib/edge.ts calls countryFrom", () => {
  const files = [
    "app/store/[slug]/analytics/events/route.ts",
    "lib/analytics/order-attribution.ts",
    "lib/consent/read.ts",
    "lib/edge.ts",
  ];
  // The three former callers plus the gate itself. Any other file that starts calling it is
  // caught by the repository-wide search below; these are listed so the search has something
  // to be a regression against.
  for (const file of files.slice(0, 3)) {
    const source = readFileSync(file, "utf8");
    assert.ok(
      !/\bcountryFrom\(/.test(source),
      `${file} calls countryFrom directly — use countryFromTrusted from lib/edge.ts`,
    );
    assert.ok(
      /countryFromTrusted\(/.test(source),
      `${file} no longer reads a country at all, which is probably not what was intended`,
    );
  }
  const gate = readFileSync("lib/edge.ts", "utf8");
  assert.ok(/\bcountryFrom\(headers\)/.test(gate), "lib/edge.ts is no longer the gate");
});

// ------------------------------------------------------------------ the rate limiter's key
check("client-ip-edge", "behind the edge, the address the edge reported is the rate-limit key", () => {
  assert.equal(trustedClientIp(forged({ [EDGE_TOKEN_HEADER]: SECRET }), LOCKED), "203.0.113.9");
  assert.equal(clientIp(forged({ [EDGE_TOKEN_HEADER]: SECRET }), LOCKED), "203.0.113.9");
});

check("client-ip-forged", "a forged cf-connecting-ip is ignored and the hop counting takes over", () => {
  assert.equal(trustedClientIp(forged(), LOCKED), null);
  assert.equal(clientIp(forged(), LOCKED), "9.9.9.9");
});

check("client-ip-off", "with no edge declared, cf-connecting-ip is not used either", () => {
  // `off` means "nothing has been declared in front of this origin", so there is no edge whose
  // word to take — the header could be anybody's. The hop counting is what it always was.
  assert.equal(trustedClientIp(forged(), OFF), null);
  assert.equal(clientIp(forged(), OFF), "9.9.9.9");
});

// ------------------------------------------------------------------ the https upgrade
const url = new URL("http://shop.example.com/products/cap?size=l");

check("https-off", "with EDGE_FORCE_HTTPS off, a plaintext request is served as before", () => {
  assert.equal(httpsRedirectUrl(url, new Headers({ "x-forwarded-proto": "http" }), OFF), null);
});

check("https-on", "an explicit x-forwarded-proto: http is upgraded, path and query intact", () => {
  const to = httpsRedirectUrl(url, new Headers({ "x-forwarded-proto": "http" }), {
    ...OFF,
    forceHttps: true,
  });
  assert.equal(to?.toString(), "https://shop.example.com/products/cap?size=l");
});

check("https-absent", "an ABSENT proto header is left alone — that is the healthcheck, and a loop", () => {
  const config = { ...OFF, forceHttps: true };
  assert.equal(httpsRedirectUrl(url, new Headers(), config), null);
  assert.equal(
    httpsRedirectUrl(url, new Headers({ "x-forwarded-proto": "https" }), config),
    null,
  );
});

check("https-chain", "a proto chain is read from the left, where the client's own protocol is", () => {
  const config = { ...OFF, forceHttps: true };
  const to = httpsRedirectUrl(url, new Headers({ "x-forwarded-proto": "http, https" }), config);
  assert.equal(to?.protocol, "https:");
  assert.equal(
    httpsRedirectUrl(url, new Headers({ "x-forwarded-proto": "https, http" }), config),
    null,
  );
});

// ------------------------------------------------------------------ response headers
check("headers-base", "every response carries the three headers that are true of every page", () => {
  const headers = securityHeaders(OFF);
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.match(headers["Permissions-Policy"], /geolocation=\(\)/);
});

check("hsts-absent", "HSTS is absent at the default max-age of 0", () => {
  assert.equal(securityHeaders(OFF)["Strict-Transport-Security"], undefined);
});

check("hsts-present", "HSTS appears only when a max-age was set deliberately", () => {
  const headers = securityHeaders({ ...OFF, forceHttps: true, hstsMaxAge: 31_536_000 });
  assert.equal(
    headers["Strict-Transport-Security"],
    "max-age=31536000; includeSubDomains; preload",
  );
});

// ------------------------------------------------------------------ the environment's own rules
const BASE = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/multitenant",
  AUTH_SECRET: "a".repeat(32),
};

check("env-default", "the shipped default is: no edge, no forced https, no HSTS", () => {
  const parsed = envSchema.parse({ ...BASE });
  assert.equal(parsed.EDGE_TRUST_MODE, "off");
  assert.equal(parsed.EDGE_FORCE_HTTPS, false);
  assert.equal(parsed.EDGE_HSTS_MAX_AGE, 0);
});

check("env-secret", "cloudflare mode with no secret refuses to boot", () => {
  const bad = envSchema.safeParse({ ...BASE, EDGE_TRUST_MODE: "cloudflare" });
  assert.equal(bad.success, false);
  assert.match(bad.error!.issues.map((i) => i.message).join(" "), /EDGE_SHARED_SECRET is required/);
  assert.equal(
    envSchema.safeParse({ ...BASE, EDGE_TRUST_MODE: "cloudflare", EDGE_SHARED_SECRET: SECRET })
      .success,
    true,
  );
});

check("env-short-secret", "a short shared secret is refused rather than accepted quietly", () => {
  assert.equal(
    envSchema.safeParse({ ...BASE, EDGE_TRUST_MODE: "cloudflare", EDGE_SHARED_SECRET: "short" })
      .success,
    false,
  );
});

check("env-hsts", "HSTS cannot be advertised from an origin that still answers plain http", () => {
  assert.equal(envSchema.safeParse({ ...BASE, EDGE_HSTS_MAX_AGE: "31536000" }).success, false);
  assert.equal(
    envSchema.safeParse({
      ...BASE,
      EDGE_FORCE_HTTPS: "true",
      EDGE_HSTS_MAX_AGE: "31536000",
    }).success,
    true,
  );
});

// ------------------------------------------------------------------ committed configuration
check("config-off", "no committed configuration turns the edge or HSTS on (D74, P7-16)", () => {
  for (const file of [".env.example", "docker-compose.yml"]) {
    const source = readFileSync(file, "utf8");
    const hsts = source.match(/EDGE_HSTS_MAX_AGE[:=]\s*"?\$?\{?[A-Z_]*:?-?(\d+)/);
    assert.ok(hsts, `${file} does not mention EDGE_HSTS_MAX_AGE at all`);
    assert.equal(hsts[1], "0", `${file} ships a non-zero HSTS max-age`);
    assert.ok(
      /EDGE_TRUST_MODE[:=]\s*"?(\$\{EDGE_TRUST_MODE:-off\}|off)"?/.test(source),
      `${file} does not default EDGE_TRUST_MODE to off`,
    );
    assert.ok(
      !/EDGE_SHARED_SECRET[:=]\s*"[^"$]/.test(source),
      `${file} appears to contain a literal EDGE_SHARED_SECRET`,
    );
  }
});

// ------------------------------------------------------------------ the runbook
check("runbook", "EDGE_HARDENING.md still names the way back out", () => {
  const doc = readFileSync("EDGE_HARDENING.md", "utf8");
  // The origin lock is the step that can make a deployment unreachable (§9 of the plan's risks),
  // so the document is only useful if the break-glass path is in it.
  assert.match(doc, /SSH \(port 22\) and the Dokploy dashboard/, "no break-glass path");
  assert.match(doc, /grey cloud/i, "the custom-domain ordering constraint (D84) is missing");
  assert.match(doc, /P7-12 to P7-16/, "does not say which checks are left to the pilot");
  assert.match(doc, /HSTS enabled on:/, "no line to record the date HSTS was turned on");
});

// ------------------------------------------------------------------ the proxy is actually wired
check("proxy-wiring", "proxy.ts applies all three, and the upgrade runs before the session", () => {
  const source = readFileSync("proxy.ts", "utf8");
  for (const fn of ["httpsRedirectUrl", "sanitizeEdgeHeaders", "securityHeaders"]) {
    assert.ok(source.includes(`${fn}(`), `proxy.ts does not call ${fn}`);
  }
  assert.ok(
    source.indexOf("httpsRedirectUrl(") < source.indexOf("await route()"),
    "the https upgrade must happen before the host is resolved and the session is read",
  );
  assert.match(
    source.match(/function withStoreSlugHeader[\s\S]{0,400}/)?.[0] ?? "",
    /sanitizeEdgeHeaders\(req\.headers\)/,
    "the storefront rewrite must be built on sanitized headers — it carries the ingestion route",
  );
});

console.log(`\n${checks} checks passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);

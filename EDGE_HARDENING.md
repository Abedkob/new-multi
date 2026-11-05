# Edge hardening (Phase 7, D74 / D75 / D83)

What sits in front of this origin, what the application is allowed to believe because of it, and
the order to turn it on in. Read this before touching Cloudflare or the reverse proxy; the last
section is the way back out.

## 1. The problem, stated once

`lib/analytics/request.ts` reads `cf-ipcountry` (and the Vercel/generic equivalents) and trusts
whichever appears. `lib/rate-limit.ts` reads `x-forwarded-for`. Both are correct behind an edge
and forgeable without one: anyone who can open a TCP connection to the origin can send

```
cf-ipcountry: FR
cf-connecting-ip: 203.0.113.<random>
```

and write a country of their choosing into the analytics tables while never meeting a rate
limit. Nothing in the application can tell the difference, because by the time a request reaches
Next its peer address is the local reverse proxy either way.

So there are two halves, and **the first one is not in this repository**:

| Half | Where | What it does |
|---|---|---|
| The origin lock | reverse proxy (§4) | HTTP reaches the app only from Cloudflare, and the edge headers are stripped from anything else |
| The trust gate | `lib/edge.ts` (§5) | A request is believed only if it carries a secret the edge adds; readers of forgeable metadata go through one function |

The second exists because the first is a proxy configuration that somebody will reasonably
change one day, and because it is the half a verification script can hold down.

## 2. What this does not cover

- **Forging `x-forwarded-proto`.** It can only make the origin *skip* an upgrade to https, never
  fake one. What stops a plaintext request is the edge refusing to make one.
- **A CSP.** Storefronts inject each owner's own GA4/Meta snippets and the templates ship inline
  styles; a useful policy needs per-request nonces threaded through 13 templates. See
  `KNOWN_GAPS.md`. The `/uploads/*` sandbox CSP in `next.config.ts` is the one place one is
  enforced today.
- **`X-Frame-Options`.** The platform theme editor and the content editor both render a store in
  an iframe. A blanket `DENY` would break both.
- **Anything on ports other than HTTP(S).** Deliberately — see §8.

## 3. The order it is turned on in

Doing these out of order is how a store's domain becomes unconnectable or a deploy becomes
unreachable. Each step is reversible on its own; the combination is not, once §9 is done.

1. **Connect the domain in the platform admin while it is DNS-only (grey cloud).** This is a
   hard ordering constraint, not a preference — see §7.
2. Cloudflare SSL/TLS settings and the origin certificate (§4a).
3. The Transform Rule that adds `x-edge-token` (§4b), then `EDGE_TRUST_MODE=cloudflare` plus
   `EDGE_SHARED_SECRET` in the environment. **Rule first, app second**: an origin that is
   briefly stricter than the edge loses every visitor's country, which is recoverable; the
   reverse loses the guard while looking fine.
4. Turn the orange cloud on.
5. `EDGE_FORCE_HTTPS=true` (§4a), once the edge terminates TLS.
6. The origin IP lock (§4c). **This is the step that can lock you out**; read §8 first.
7. HSTS, last, after a week of real traffic (§9).

## 4. Cloudflare

### a. TLS

- **SSL/TLS encryption mode: Full (strict).** Install a Cloudflare Origin Certificate on the
  reverse proxy. *Flexible* gives the browser a padlock while the edge-to-origin leg is
  plaintext, which produces exactly the `Secure`-cookie behaviour Phase 7 is trying to test and
  none of the safety.
- **Always Use HTTPS: on.** **Automatic HTTPS Rewrites: on.**
- Then `EDGE_FORCE_HTTPS=true` so the origin also refuses to answer a plaintext request it
  somehow receives. It fires only on an explicit `x-forwarded-proto: http`; an absent header is
  left alone, because that is what the container's own healthcheck sends and because a redirect
  answered by a proxy that re-sends the same headers is a loop rather than an upgrade.

### b. The Transform Rule

Rules → Transform Rules → **Modify Request Header** → *Add*:

```
Header name:  x-edge-token
Value:        <the EDGE_SHARED_SECRET value>
Expression:   true        (all incoming requests to this zone)
```

Generate the value with `openssl rand -hex 32`. It goes into Cloudflare's rule and into the
Dokploy environment, and **nowhere else** — not into this repository, not into a commit, not
into a chat message. Rotating it means setting the rule's value and the environment variable in
that order, with a redeploy between.

This is the only thing the origin can verify by itself, which is why it exists: an IP range check
needs the socket's peer address, and inside Next that is always the local proxy.

### c. The origin lock

The goal: the HTTP origin accepts connections only from Cloudflare's published ranges, and every
request that arrives another way has `cf-*`, `true-client-ip`, `x-vercel-ip-country` and
`x-geo-country` stripped before it reaches the app.

Two things make this environment-specific rather than a file in this repository:

- **The Traefik in front of this app is Dokploy's, and it is shared with every other deployment
  on the box.** A global `entryPoint` restriction would apply to all of them. The restriction
  belongs on *this* service's router, as middleware.
- Cloudflare's ranges change. Fetch them at apply time rather than committing a stale list — a
  list that is one range out of date refuses legitimate visitors, with no error anywhere:

  ```bash
  curl -s https://www.cloudflare.com/ips-v4 https://www.cloudflare.com/ips-v6 | paste -sd,
  ```

The middleware pair, as Traefik v3 labels on the `app` service (`ipallowlist`, not v2's
`ipwhitelist`; an empty `customrequestheaders` value *removes* a header):

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.docker.network=dokploy-network"
  - "traefik.http.middlewares.cf-only.ipallowlist.sourcerange=<the list from the curl above>"
  - "traefik.http.middlewares.cf-strip.headers.customrequestheaders.Cf-Connecting-Ip="
  - "traefik.http.middlewares.cf-strip.headers.customrequestheaders.Cf-Ipcountry="
  - "traefik.http.middlewares.cf-strip.headers.customrequestheaders.True-Client-Ip="
  - "traefik.http.middlewares.cf-strip.headers.customrequestheaders.X-Vercel-Ip-Country="
  - "traefik.http.middlewares.cf-strip.headers.customrequestheaders.X-Geo-Country="
  # Attach both to the router Dokploy created for this service. Find its name in Traefik's
  # dashboard or with `docker inspect` on the container; it is generated, so it is not written
  # here where it would be wrong on the next redeploy.
  # - "traefik.http.routers.<router>.middlewares=cf-only@docker,cf-strip@docker"
```

Not committed into `docker-compose.yml`, and not asserted by any script in this repository:
these labels were written from Traefik's documentation and have **not** been applied to a live
Dokploy install — when you apply them, confirm with `curl` to the origin's IP directly (expect
403) and from the domain (expect 200), and correct this section with what actually worked.

If `ipallowlist` turns out to see Traefik's own address rather than the client's, the alternative
is **Cloudflare Authenticated Origin Pulls** (mTLS from the edge, verified by the proxy), which
needs no range list and does not go stale. Either way the strip middleware is worth having on
its own: it is what makes the `x-edge-token` check in §5 the *only* way to be believed.

## 5. The application's half

`lib/edge.ts` is the whole of it. Four environment variables, all defaulting to the pre-Phase-7
behaviour so a deploy that sets none of them behaves as it did:

| Variable | Default | Meaning |
|---|---|---|
| `EDGE_TRUST_MODE` | `off` | `off`: proxy metadata is believed (dev, or an origin nobody can reach). `cloudflare`: believed only with a valid `x-edge-token`. |
| `EDGE_SHARED_SECRET` | unset | The Transform Rule's value. **Required** when the mode is `cloudflare` — the app refuses to boot otherwise, rather than silently trusting nothing. |
| `EDGE_FORCE_HTTPS` | `false` | Redirect an explicit `x-forwarded-proto: http` to https (308). |
| `EDGE_HSTS_MAX_AGE` | `0` | Seconds; 0 means the header is absent. §9. |

What follows from an untrusted request: `countryFromTrusted` returns `null` (an unmeasured
dimension stays unknown, §4.5 — the report layer already tells "no country" from "a country"),
`clientIp` ignores `cf-connecting-ip` and falls back to counting `x-forwarded-for` hops, and the
proxy drops the edge headers from the request on its way in.

`pnpm verify:edge` holds this down statically, including the rule that **nothing but
`lib/edge.ts` may call `countryFrom`** — one gate, rather than one per reader and a comment
asking everyone to remember.

### `TRUSTED_PROXY_COUNT`

With Cloudflare in front of Dokploy's Traefik there are two proxies appending to
`x-forwarded-for`, so the correct value is **2**, not the shipped default of 1. Set it when you
turn the orange cloud on.

In `cloudflare` mode a trusted request does not use it at all — `cf-connecting-ip` is the client
— which is the point: one number that has to match the deployment's shape, where being wrong by
one puts either every visitor or the whole internet into a single rate-limit bucket, quietly.
Set it correctly anyway, for requests that arrive without the token.

## 6. Verifying it

`pnpm verify:edge` is static: no server, no database, no browser. It asserts the trust gate's
behaviour at each mode, that HSTS is absent by default and that no committed configuration turns
it on, that the strip list covers every header the country reader looks at, that the chokepoint
has no second caller, and that this document still names its break-glass path.

**It does not verify the live edge**, and does not pretend to. Those are P7-12 to P7-16 in
`PHASE_7_PLAN.md` — http→https at the edge, a `Secure` cookie surviving a round trip, a forged
`cf-ipcountry` refused by the real origin, the tracker accepted on a custom domain, HSTS present
only once enabled — and they need the real domain, so they run at the pilot. A check that can
only pass when an environment happens to be configured is a skip wearing a passing colour, which
this repository's E2E policy already forbids.

When you do run them, the useful commands against the live host are:

```bash
curl -sI http://<domain>/                                   # expect 301/308 to https
curl -sI https://<domain>/ | grep -i strict-transport        # expect nothing until §9
curl -sI https://<origin-ip>/ -H "Host: <domain>"            # expect 403 once §4c is applied
```

## 7. The orange cloud and custom-domain verification

`lib/domain-check.ts`'s `checkDomainResolves` requires the domain's A record to equal
`SERVER_PUBLIC_IP` exactly before `Tenant.domain` is saved — that gate is what makes the field's
"verified and live" contract true, and everything downstream (the proxy's rewrite, sitemaps,
canonicals, redirects) relies on it.

A Cloudflare-proxied domain resolves to **Cloudflare's** addresses. So while the orange cloud is
on, that domain **cannot be connected or re-saved** in the platform admin: the save is refused
with `wrong-ip`.

The consequence, concretely:

- Connect the domain first, grey cloud, then turn the proxy on (§3, step 1). It keeps working —
  the check runs at save time, not per request.
- If the domain ever has to be changed or re-saved, turn the proxy off, save, turn it back on.

This conflict is recorded as **D84** rather than fixed. Accepting "resolves into Cloudflare's
ranges" would weaken the one gate behind that invariant, and widening it two weeks before a
pilot is a worse trade than an ordering step written down. It also wants the range list this
section spent §4c arguing not to commit.

## 8. Break-glass

**SSH (port 22) and the Dokploy dashboard's own port stay outside every restriction in this
document.** That is deliberate: the forgeable header arrives over HTTP, so locking HTTP is the
whole benefit, and losing access to the box that serves it would be a worse failure than the one
being prevented.

If the origin lock goes wrong — the site 403s for real visitors, or Cloudflare's ranges moved:

1. SSH in.
2. Remove the `cf-only` middleware from the router (`docker-compose.yml` labels, or Dokploy's UI
   for this service), and redeploy that service only. The strip middleware can stay; it refuses
   nothing.
3. The app keeps working with `EDGE_TRUST_MODE=cloudflare` — the token check is independent of
   the IP lock. Only set it back to `off` if the Transform Rule itself is the problem, and
   remember that `off` means every country in the analytics tables is whatever the client said.

If HSTS is the problem, see §9 — it is the one step this list cannot undo quickly.

## 9. HSTS, last

`EDGE_HSTS_MAX_AGE` stays `0` in `.env.example`, in `docker-compose.yml`, and in every
environment until the pilot store has served a week of real traffic (D74). It is the one setting
that cannot be withdrawn quickly: a browser that has seen the header will refuse plaintext for
`max-age` seconds regardless of what the server later says, and `includeSubDomains` extends that
to every subdomain of the platform's host — including any that is not ready for it.

When it goes on:

```
EDGE_FORCE_HTTPS="true"
EDGE_HSTS_MAX_AGE="31536000"
```

and record the date here, because P7-16 asks for it:

- HSTS enabled on: _not yet enabled_

# Human checklist

The things I cannot do, in the order they are needed, with what each one has to produce. This is
§8 of [PHASE_7_PLAN.md](PHASE_7_PLAN.md) as a file you can tick somewhere durable.

Nothing here blocks commits 1–10: those are code, configuration and documents, and they are
done or in progress without any of it. What this list blocks is the pilot and the launch.

The ordered procedure each item belongs to is [PHASE_7_DEPLOY_CHECKLIST.md](PHASE_7_DEPLOY_CHECKLIST.md);
this is the subset only you can do.

---

## Decisions

- [x] **D73 — what staff may do.** Answered 2026-11-05: staff **do** see a customer's phone
      number (you cannot pack a box without it), and cancelling an order is **owner-only**. Both
      are in the shipped capability table and exercised by `pnpm verify:staff`.
- [ ] **D81 — does `main` get this?** Phase 7 lands on `analytics/phase-1` and merges into
      `codex/new-brand-migration`. Nothing in it touches `main`. If the pilot or the launch is
      meant to run from `main`, say so; it is not assumed anywhere.

## The domain and the edge

The order matters. [EDGE_HARDENING.md](EDGE_HARDENING.md) §3 is the same list with the reasons.

- [ ] **Buy the test domain** and tell me the name, so `allowedDevOrigins` and the live edge
      checks can use it. A throwaway `.com` is fine. (It was never needed for the nine
      custom-domain E2E legs — those drive their own `*.test` hostnames through Chrome's
      resolver — only for the edge.)
- [ ] **Connect it in the platform admin while it is still DNS-only (grey cloud).** A
      Cloudflare-proxied domain resolves to Cloudflare, and the save-time DNS check requires the
      A record to be this server's own IP, so connecting it after the orange cloud is on is
      refused (D84).
- [ ] **Cloudflare**: nameservers moved, SSL/TLS **Full (strict)**, origin certificate installed
      on the proxy, *Always Use HTTPS* and *Automatic HTTPS Rewrites* on. Tell me when the
      padlock is real.
- [ ] **Create the Transform Rule** that adds `x-edge-token`, with a value from
      `openssl rand -hex 32`. Then set `EDGE_SHARED_SECRET` to the same value and
      `EDGE_TRUST_MODE=cloudflare` in Dockploy — rule first, app second.
- [ ] **Turn the orange cloud on**, then `EDGE_FORCE_HTTPS=true` and `TRUSTED_PROXY_COUNT=2`.
- [ ] **Apply the origin lock** (EDGE_HARDENING.md §4c) and confirm it with the two curls in §6.
      The Traefik labels there were written from Traefik's documentation and have never run
      against a live Dockploy install, so correct that section with what actually worked. Read
      §8 first — SSH and the Dockploy dashboard stay outside the lock, and that is the way back
      out.
- [ ] **Run P7-12 to P7-16** against the live host: http→https, a `Secure` cookie surviving a
      round trip, a forged `cf-ipcountry` refused at the origin, the tracker accepted on the
      custom domain, and HSTS still absent.

## Keys and secrets

- [ ] **Generate the production keys** and put them in Dockploy only — never in a file in the
      repository, never pasted into a chat. The exact four names, which is what D78 was about:
      `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT`,
      `PUSH_ENCRYPTION_KEY`. Commands are in PHASE_7_DEPLOY_CHECKLIST.md §1.
- [ ] **Understand that the VAPID pair must never change** (D77). Rotating
      `PUSH_VAPID_PRIVATE_KEY` stops every installed device receiving anything and tells none of
      them. `PUSH_ENCRYPTION_KEY` is the one that can be rotated, with a re-encrypt pass.
- [ ] **Generate `ANALYTICS_SIGNING_SECRET`** if production does not already have one, and know
      that changing it invalidates every stored consent decision — every visitor is asked again.

## The database

- [ ] **Verify the production `app_user`** with the five queries in `DEPLOYMENT_CHECKLIST.md`
      plus the four in `ANALYTICS_DEPLOY_CHECKLIST.md` §4. This is yours because it runs against
      the live database. All of them must come back as documented; query 4 returning anything
      other than zeros means RLS is inert in production, which is the one failure here that
      looks like success.
- [ ] **Backup and restore drill** (P7-24). The script exists and passes here:
      `pnpm drill:restore` dumps, restores into a scratch database and checks the copy. What is
      yours is running it **on the VPS** and then booting the app against the restored copy —
      the drill prints the two commands. Note `pg_dump` writes no `CREATE ROLE`, so a restore
      onto a fresh machine needs `scripts/sql/rls-role.sql` first.
- [ ] **Load test on the VPS** (P7-23): `BASE_URL=https://<host> pnpm load-test --levels=30,100,150,300`
      against a production build. The laptop numbers in CLAUDE.md are not a substitute — they
      had the database and the load generator on the same machine, and 300 concurrent failed
      64% there against 10% in the earlier recorded run. Write down what the real server does.
- [ ] **Penetration test against the real deployment**:
      `BASE_URL=https://<host> pnpm pentest:cross-tenant`. 31 attempts, all must be refused.
- [ ] **Run retention's first production pass as a dry run** (P7-26) and read the output before
      letting it delete anything:
      `node dist/analytics-scheduled.mjs --stage=retention --dry-run` **inside the container**
      (`pnpm analytics:scheduled` is the development spelling and is not in the image), or
      `ANALYTICS_RETENTION_DRY_RUN=true` for the scheduled command's first run.

## The pilot

- [ ] **Pick the pilot store.** One real store with real orders, whose owner knows they are in a
      pilot and will tell you when something looks wrong. A store with no orders proves nothing;
      the window is 7 days and at least 20 orders (D80).
- [ ] **Tell the pilot owner about `isPaused`** — the kill switch that is independent of
      licensing and of the analytics rollout.
- [ ] **Compare the pilot's analytics against the authoritative orders** at the end of the
      window and write the two numbers down (P7-27). Exactly equal, or it is a finding.

## Real devices and real screens

No headless check can prove any of these.

- [ ] **iPhone**: install `/admin` to the Home Screen, enable notifications, place a real order,
      record how long it took and what the lock screen said. Then with the amount toggle on.
      Then in Arabic. (P7-33, carried over from P6-32.)
- [ ] **Android**: the same, plus confirm the install prompt appears and the icon is the new
      one — commit 7 fixed two reasons it could not have worked, but only a device can confirm
      it does. (P7-34, P7-18, P7-19.)
- [ ] **Both apps install as two apps** with two different Home Screen icons, the merchant's and
      the operator's.
- [ ] **Every admin and report screen in Arabic, RTL, on your phone** (P7-35): the report
      screens, the marketing tabs, the notification settings.
- [ ] **The import template, in the spreadsheet program the merchant really has.** Download it,
      open it, type three products, save, upload. `scripts/fixtures/sheets/excel-authored.xlsx`
      holds one file Excel 16 wrote and `verify:sheet` parses it on every run, which is what keeps
      the known defect fixed — a merchant's `=10+9.99` is stored as `19.990000000000002` and was
      refused as an invalid price. A fixture cannot speak for a version it was not written by, so
      confirm on: **Excel on Windows**, **Excel on a Mac or the web**, **Google Sheets**
      (download as .xlsx) and **LibreOffice**. What to look for: the dropdown on Category offers
      the store's categories and still accepts a new one, the header note explains the column, the
      Arabic template opens right-to-left with no mojibake, and nothing reports a repaired file.

## Before launch

- [ ] **Legal review** (P7-37, D82) — privacy content, consent wording, retention periods, the
      joint-controller language. **This is a gate**: `ANALYTICS_ROLLOUT_MODE=all` waits for it.
- [ ] **Turn HSTS on, last**, a week after the pilot store has served real traffic, and record
      the date at the end of EDGE_HARDENING.md (P7-16). It is the one setting in this phase that
      cannot be withdrawn quickly.

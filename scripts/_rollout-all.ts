/**
 * Puts this process in `ANALYTICS_ROLLOUT_MODE=all` before lib/env.ts is read.
 *
 * Import it FIRST, above everything else, the same way scripts/_owner does — `lib/env.ts`
 * validates and freezes the environment at import time, and ES module imports are hoisted, so an
 * assignment in a suite's own module body would run too late.
 *
 * Why it exists. The scheduled stages select the stores they process through
 * `participationWhere()` (lib/analytics/rollout.ts), which keys on the rollout mode and matches
 * NO store while the mode is `off` — the default, and what a development .env has. That is
 * correct in production: a store outside the rollout must not be aggregated, or it collects a row
 * of zeros and its dashboard claims nobody came. But it means a suite that exercises the
 * aggregation machinery against its own fixture store now has to say so, or it silently tests a
 * job that walked zero tenants and asserts against figures nothing computed.
 *
 * `pnpm verify:aggregates` failed exactly that way the day the gate landed, which is also the
 * argument for this being a shared module rather than a line in one suite: the next suite to run
 * a real stage should import it rather than rediscover the problem.
 *
 * Only `verify:aggregates` imports it today, because that is the one place the need was
 * demonstrated. `verify:health` and `verify:notifications` also run real stages and are the
 * likely next two — neither could be verified on the machine this landed on (one needs a running
 * server, the other exhausted the connection pool), so neither was changed on a guess.
 * `verify:scheduled` deliberately does NOT need it: it injects its own stages, and importing this
 * changed its timing enough to break a lock assertion.
 *
 * A suite testing the GATE ITSELF must not import this — `pnpm verify:rollout` exercises all
 * three modes as pure functions and needs the real environment.
 */

process.env.ANALYTICS_ROLLOUT_MODE = "all";
delete process.env.ANALYTICS_PILOT_TENANT_SLUG;

/**
 * Phase 5 verification: the Marketing section — saved campaigns and Results
 * (pnpm verify:campaigns — P5-12, P5-13, P5-14, P5-15, P5-19, D38, D39).
 *
 * D39's whole design is a separation: a campaign's NUMBERS come from the data, and its NAME
 * comes from a row an owner may or may not have saved. Everything that can go wrong here is one
 * of the two leaking into the other:
 *
 *   - a report that only counts saved campaigns would hide traffic the store really got;
 *   - a saved row carrying its own numbers would eventually disagree with the report beside it;
 *   - a saved row whose utm value differs by one character from the link it describes shows the
 *     same campaign twice, once named with no numbers and once numbered with no name.
 *
 * The last one is the quiet one, and it is a normalization bug: the builder slugifies in the
 * browser and the action slugifies on the server. They share lib/utm.ts for exactly that reason,
 * and a check below holds them to it.
 *
 * Tenant isolation for MarketingCampaign is NOT here: a DB-level claim has to run as the
 * restricted role, and this script (like its neighbours) imports ./_owner. verify:isolation
 * owns it — "cannot read or write another store's saved campaign".
 *
 * No server needed.
 */

import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { prisma } from "../lib/prisma";
import { createStoreWithOwner } from "../lib/data/tenants";
import {
  listCampaignLines,
  listSavedCampaigns,
  saveCampaign,
  setCampaignArchived,
} from "../lib/data/campaigns";
import { lastNLocalDays } from "../lib/analytics/compare";
import { localDayToDate } from "../lib/analytics/local-day";
import { slugifyUtm } from "../lib/utm";
import { saveCampaignSchema } from "../lib/validation";

const BEIRUT = "Asia/Beirut";
const TODAY = "2026-11-04";
const AT = new Date(`${TODAY}T10:00:00.000Z`);

let checks = 0;
const ok = (id: string, message: string) => {
  checks++;
  console.log(`  ok  ${id.padEnd(7)} ${message}`);
};

/**
 * The structural half: a report may not read the campaign table, and the campaign table may not
 * hold a number.
 */
function structureChecks() {
  const report = readFileSync("lib/analytics/report.ts", "utf8");
  assert.ok(
    !report.includes("@/lib/data/campaigns"),
    "report.ts must not read MarketingCampaign — a figure that depends on whether the owner " +
      "saved the campaign is a figure that disappears when they forget",
  );
  ok("P5-14", "the report layer cannot see the saved-campaign table at all");

  // The model, from the schema: every field it holds, and not one of them a number. A count or
  // a revenue column here is how this row and the report start disagreeing a month later.
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const model = /model MarketingCampaign \{([\s\S]*?)\n\}/.exec(schema);
  assert.ok(model, "the MarketingCampaign model must exist");
  const fields = model[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//") && !line.startsWith("/") && !line.startsWith("@@"))
    .map((line) => line.split(/\s+/));
  const numeric = fields.filter(([, type]) => /^(Int|Float|Decimal|BigInt)\??$/.test(type ?? ""));
  assert.deepEqual(numeric, [], `MarketingCampaign holds numbers: ${numeric.map((f) => f[0])}`);
  assert.ok(
    /FORCE ROW LEVEL SECURITY/.test(
      readFileSync("prisma/migrations/20261106140000_marketing_campaign/migration.sql", "utf8"),
    ),
    "the table is tenant-scoped, so its migration must force RLS (P4-23a counts it)",
  );
  ok("D39", `the saved row holds ${fields.length} fields and no numbers, under forced RLS`);

  // P5-15's other half — the component is still free of the page it is on. The forbidden-import
  // list itself lives in verify:acquisition (P4-35); what is checked here is the one thing
  // Phase 5 added: the save arrives as a prop, and the slug rule is shared rather than copied.
  const builder = readFileSync("components/analytics/link-builder.tsx", "utf8");
  assert.ok(
    /onSaveCampaign\?:/.test(builder),
    "the save handler must be an optional prop, so the tab decides and the component does not",
  );
  assert.ok(!builder.includes("use server"), "and it must still import no action of its own");
  assert.ok(
    builder.includes('from "@/lib/utm"') && !/const slugifyUtm =/.test(builder),
    "the builder must use the shared slug rule, not its own copy of it",
  );
  const linksPage = readFileSync("app/admin/(panel)/marketing/links/page.tsx", "utf8");
  assert.ok(
    linksPage.includes("onSaveCampaign={saveCampaignAction}"),
    "the route is what passes the action in",
  );
  ok("P5-15", "the builder takes the save as a prop and shares one slug rule with the server");
}

/** The slug rule, where it bites: the link and the saved row must agree exactly. */
function normalizationChecks() {
  for (const typed of ["Eid Sale 2026", " eid--sale  2026 ", "EID_SALE_2026!", "eid sale 2026"]) {
    const inLink = slugifyUtm(typed);
    const parsed = saveCampaignSchema.safeParse({
      name: typed,
      utmCampaign: typed,
      channel: "instagram",
      destinationPath: "/shop",
    });
    assert.ok(parsed.success, `"${typed}" must be savable`);
    assert.equal(
      parsed.data.utmCampaign,
      inLink,
      `"${typed}" would be saved as "${parsed.data.utmCampaign}" and arrive in the URL as ` +
        `"${inLink}" — the campaign would appear twice, named once and counted once`,
    );
    assert.equal(parsed.data.utmCampaign, "eid-sale-2026");
  }
  // A name with nothing in it that survives slugification cannot be saved: an empty utm value
  // would join to every untagged visit the store ever had.
  for (const empty of ["???", "   ", "---", "…"]) {
    assert.equal(
      saveCampaignSchema.safeParse({
        name: `name ${empty}`,
        utmCampaign: empty,
        channel: "custom",
        destinationPath: "",
      }).success,
      false,
      `"${empty}" slugifies to nothing and must be refused, not saved as the empty campaign`,
    );
  }
  // The destination and channel are the builder's own values and are still held to a shape.
  assert.equal(
    saveCampaignSchema.safeParse({
      name: "ok",
      utmCampaign: "ok",
      channel: "instagram",
      destinationPath: "/shop?x=1",
    }).success,
    false,
    "a destination with a query string is not one the builder makes",
  );
  ok("D39", "4 spellings of one campaign normalize to the same value the link carries, 4 empty ones are refused");
}

async function storedChecks() {
  const run = Date.now().toString(36);
  const store = await createStoreWithOwner({
    storeName: `Campaigns ${run}`,
    ownerName: "C",
    ownerEmail: `campaigns-${run}@example.test`,
    passwordHash: "x",
  });
  const T = store.tenant.id;
  await prisma.tenant.update({ where: { id: T }, data: { analyticsTimezone: BEIRUT } });
  const range = lastNLocalDays(28, AT, BEIRUT);

  try {
    // P5-13: saved, no traffic. The tab must list it, with zeros.
    await saveCampaign(T, {
      name: "Eid sale",
      utmCampaign: "eid-sale",
      channel: "instagram",
      destinationPath: "/shop",
    });
    let lines = await listCampaignLines(T, range);
    assert.equal(lines.length, 1, "a saved campaign must be listed before any traffic arrives");
    assert.equal(lines[0].label, "Eid sale", "under the name the owner gave it");
    assert.equal(lines[0].observed, null, "with nothing observed");
    // What the page does with a null: zero, never a dash. "—" says "unknown", and this is known.
    const page = readFileSync("app/admin/(panel)/marketing/campaigns/campaign-table.tsx", "utf8");
    assert.ok(
      /line\.sessions \?\? 0/.test(page) && !/line\.sessions \?\? "—"/.test(page),
      "no traffic yet must render as 0, not as an unknown",
    );
    ok("P5-13", "a campaign saved a minute ago is listed with zeros, not missing");

    // P5-14: observed, never saved.
    await prisma.analyticsAcquisitionDaily.createMany({
      data: [
        {
          tenantId: T,
          localDay: localDayToDate(TODAY),
          timeZone: BEIRUT,
          sourceKind: "campaign",
          source: "whatsapp",
          medium: "social",
          campaign: "never-saved",
          sessions: 12,
          lastTouchOrders: 2,
          lastTouchOrderValueCents: 4000,
        },
        // The saved one, arriving through two different sources: one campaign, one row.
        {
          tenantId: T,
          localDay: localDayToDate(TODAY),
          timeZone: BEIRUT,
          sourceKind: "campaign",
          source: "instagram",
          medium: "social",
          campaign: "eid-sale",
          sessions: 30,
          lastTouchOrders: 3,
          lastTouchOrderValueCents: 9000,
        },
        {
          tenantId: T,
          localDay: localDayToDate(TODAY),
          timeZone: BEIRUT,
          sourceKind: "campaign",
          source: "facebook",
          medium: "social",
          campaign: "eid-sale",
          sessions: 10,
          lastTouchOrders: 1,
          lastTouchOrderValueCents: 2000,
        },
      ],
    });

    lines = await listCampaignLines(T, range);
    const byUtm = new Map(lines.map((l) => [l.utmCampaign, l]));
    const unsaved = byUtm.get("never-saved");
    assert.ok(unsaved, "a campaign that only exists in the data must still be listed");
    assert.equal(unsaved.saved, null);
    assert.equal(unsaved.label, "never-saved", "named by its utm value, the only name there is");
    assert.equal(unsaved.observed?.sessions, 12);
    ok("P5-14", "a campaign nobody saved is listed with its real 12 visits");

    const eid = byUtm.get("eid-sale");
    assert.equal(lines.length, 2, "one campaign through two sources is one line, not two");
    assert.equal(eid?.observed?.sessions, 40, "its sources are added up (30 + 10)");
    assert.equal(eid?.observed?.orderValueCents, 11_000);
    assert.equal(eid?.label, "Eid sale", "and it keeps the owner's name, not the utm value");
    assert.equal(lines[0].utmCampaign, "eid-sale", "the busiest campaign sorts first");
    ok("P5-13", "a saved campaign joins its own traffic across 2 sources under one name");

    // Saving again is what an owner does on day two — it must not double the campaign.
    await saveCampaign(T, {
      name: "Eid sale 2026",
      utmCampaign: "eid-sale",
      channel: "whatsapp",
      destinationPath: "",
    });
    const saved = await listSavedCampaigns(T);
    assert.equal(saved.length, 1, "re-saving one utm value must not create a second row");
    assert.equal(saved[0].name, "Eid sale 2026", "the name is updated");
    assert.equal(saved[0].channel, "whatsapp");
    lines = await listCampaignLines(T, range);
    assert.equal(lines.length, 2, "and the list is still two campaigns");
    const resaved = lines.find((l) => l.utmCampaign === "eid-sale");
    assert.equal(resaved?.observed?.sessions, 40, "with the same numbers");
    assert.equal(resaved?.label, "Eid sale 2026", "under the new name");
    ok("D39", "saving the same campaign twice updates one row and changes no number");

    // Archiving takes it off the owner's list and leaves the data alone (which is the point).
    await setCampaignArchived(T, saved[0].id, true);
    assert.deepEqual(await listSavedCampaigns(T), [], "archived is off the default list");
    lines = await listCampaignLines(T, range);
    const archived = lines.find((l) => l.utmCampaign === "eid-sale");
    assert.ok(archived, "but its 40 visits still happened, so the campaign is still listed");
    assert.equal(archived.observed?.sessions, 40);
    assert.equal(archived.saved, null, "as an observed campaign, since the owner put it away");
    const withArchived = await listCampaignLines(T, range, "last", true);
    assert.ok(
      withArchived.find((l) => l.utmCampaign === "eid-sale")?.saved?.archivedAt,
      "and it comes back, marked archived, when the list is asked for them",
    );
    await setCampaignArchived(T, saved[0].id, false);
    assert.equal((await listSavedCampaigns(T)).length, 1, "restoring brings it back");
    ok("D39", "archiving hides the name and touches none of the 40 visits");

    // A campaign whose traffic is all outside the window: saved rows are not a range, observed
    // ones are. The saved campaign stays (it exists), its numbers go to zero (none in range).
    const quiet = await listCampaignLines(T, {
      from: "2026-01-01",
      to: "2026-01-28",
      timeZone: BEIRUT,
    });
    assert.equal(quiet.length, 1, "only the saved campaign is listed for a range with no traffic");
    assert.equal(quiet[0].utmCampaign, "eid-sale");
    assert.equal(quiet[0].observed, null, "and it reports nothing rather than last month's 40");
    ok("P5-13", "a quiet range shows the saved campaign at zero and drops the unsaved one");
  } finally {
    await prisma.analyticsAcquisitionDaily.deleteMany({ where: { tenantId: T } });
    await prisma.tenant.delete({ where: { id: T } }).catch(() => {});
    await prisma.user.delete({ where: { id: store.user.id } }).catch(() => {});
  }
}

/**
 * The Marketing section itself (D38, P5-12) and what Results is allowed to say (P5-19).
 *
 * D38's boundary is not decoration: it is the reason there is one `report.ts`. What would break
 * it is a second place that adds up its own sessions, or a marketing-shaped screen left behind
 * in settings or analytics where an owner would never find it.
 */
function sectionChecks() {
  const layout = readFileSync("app/admin/(panel)/marketing/layout.tsx", "utf8");
  for (const tab of ["results", "campaigns", "links", "integrations"]) {
    assert.ok(
      layout.includes(`/admin/marketing/${tab}`),
      `Marketing must hold the ${tab} tab (D38)`,
    );
    assert.ok(
      statSync(`app/admin/(panel)/marketing/${tab}/page.tsx`).isFile(),
      `the ${tab} tab must lead to a page that exists, not to "coming soon"`,
    );
  }
  const index = readFileSync("app/admin/(panel)/marketing/page.tsx", "utf8");
  assert.ok(index.includes("/admin/marketing/results"), "the section opens on Results");
  // Nothing marketing-shaped left where it used to live: the Phase 4 analytics route is a
  // redirect, and the owner's nav points at the section rather than at one of its tabs.
  const nav = readFileSync("components/admin/admin-nav.tsx", "utf8");
  assert.ok(nav.includes('"/admin/marketing"'), "the owner's nav must lead to the section");
  assert.ok(
    !nav.includes("/admin/analytics/links") && !nav.includes("trackedLinks"),
    "the old tracked-links entry must be gone from the nav",
  );
  ok("P5-12", "one section holds all 4 marketing tabs and nothing points at the old paths");

  // P5-19: Results reads report.ts and holds no arithmetic of its own, and the two money
  // figures are never added. (P4-22 checks the summing rule across modules; this checks that
  // the screen built on top of it did not quietly become the exception.)
  const page = readFileSync("app/admin/(panel)/marketing/results/page.tsx", "utf8");
  const table = readFileSync("app/admin/(panel)/marketing/results/results-table.tsx", "utf8");
  assert.ok(page.includes("campaignResults"), "Results must read the shared report function");
  assert.ok(
    !/orderValueCents\s*\+|\+\s*.*whatsappPotentialValueCents/.test(page + table),
    "order value and WhatsApp potential value must never be added together (§3.4)",
  );
  for (const column of [
    "results.table.visits",
    "results.table.orders",
    "results.table.whatsappClicks",
    "results.table.whatsappInterest",
  ]) {
    assert.ok(table.includes(column), `Results must keep ${column} in its own column`);
  }
  // A null is unknown, not zero — the opposite rule from Campaigns, and for the opposite
  // reason: here the figure was never measured for part of the range (D48).
  // The shared `unknown` element, and the two columns that may need it. Checked as "null maps
  // to the unknown element" rather than as a particular spelling, so the table can be rewritten
  // (it was, when the phone layout arrived) without the rule silently lapsing.
  assert.ok(
    /const unknown = <span title=\{t\("results\.unmeasured"\)\}>/.test(table),
    "the table must have one 'not measured' element, explained by results.unmeasured",
  );
  assert.ok(
    /visitorDays \?\? unknown/.test(table),
    "an unmeasured visitor count must read as unknown with an explanation, never as 0",
  );
  assert.ok(
    /whatsappPotentialValueCents === null \? unknown/.test(table),
    "and so must an unmeasured WhatsApp value",
  );
  ok("P5-19", "Results keeps visits, orders and WhatsApp apart, and unknown apart from zero");

  // One set of periods for every screen, from one module.
  const range = readFileSync("lib/analytics/range.ts", "utf8");
  assert.ok(range.includes("lastNLocalDays"), "a period must become a store-local day range");
  for (const screen of [
    "app/admin/(panel)/marketing/results/page.tsx",
    "app/admin/(panel)/marketing/campaigns/page.tsx",
  ]) {
    const source = readFileSync(screen, "utf8");
    assert.ok(
      source.includes("rangeFromPeriod"),
      `${screen} must take its range from lib/analytics/range.ts, not build its own`,
    );
  }
  ok("D38", "both Marketing screens read one shared set of store-local periods");
}

async function main() {
  structureChecks();
  sectionChecks();
  normalizationChecks();
  await storedChecks();
}

main()
  .then(() => console.log(`\nAll ${checks} campaign checks passed.`))
  .catch((error) => {
    console.error(`\nFAILED: ${error}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

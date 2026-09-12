import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PUBLIC_PLAN_CATALOGUE, RUVANAS_PRODUCTS, publicPlansForProduct } from "../lib/product-plan-catalogue.mjs";
import { regionalPlanPrice, REGIONAL_PRICE_BOOKS } from "../lib/regional-price-books.mjs";
import { ORGANISATION_TEMPLATES, canTransitionOrganisationEvent, organisationNetworkControlsEnabled, organisationTerminology, validateAnnouncementSurfaces, validateOrganisationEventWindow } from "../lib/organisations-core.mjs";
import { subscriberProductAccess } from "../lib/product-access.mjs";
import { studioDestinationAvailability, studioWorkflowPath } from "../lib/studio-product-handoff.mjs";
import { BETA_PRODUCTS } from "../lib/beta-operations.mjs";

test("ORG.0 dependency and ORG.1 catalogue establish six products and thirty plans", async () => {
  assert.deepEqual(RUVANAS_PRODUCTS, ["RETAIL", "SCHOOL", "ONLINE", "HEALTH", "FAITH", "ORGANISATIONS"]);
  assert.equal(PUBLIC_PLAN_CATALOGUE.length, 30);
  const plans = publicPlansForProduct("ORGANISATIONS");
  assert.deepEqual(plans.map((plan) => [plan.code, plan.monthlyPriceCents, plan.licensedMusicCatalogueLevel, plan.stationLimit, plan.storageLimitGb, plan.listenerLimit]), [
    ["ORGANISATIONS_START", 2490, "NONE", 1, 25, 250],
    ["ORGANISATIONS_CONNECT", 5900, "NONE", 2, 100, 1000],
    ["ORGANISATIONS_PRO", 12900, "FOCUSED", 5, 300, 5000],
    ["ORGANISATIONS_NETWORK", 29900, "PROFESSIONAL", 15, 1000, 20000],
    ["ORGANISATIONS_ENTERPRISE", 69900, "PREMIUM", 50, 3000, 100000]
  ]);
  assert.equal(plans[4].enterpriseContactRequired, true);
  const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  assert.match(schema, /HEALTH\n\s+FAITH\n\s+ORGANISATIONS/);
  assert.match(schema, /organisationsEnabled\s+Boolean/);
});

test("ORG.1 regional price books preserve authored EUR and USD prices without an Asia-wide price", () => {
  assert.deepEqual(regionalPlanPrice("ORGANISATIONS_START", "EUR"), { currency: "EUR", monthlyPriceCents: 2490 });
  assert.deepEqual(regionalPlanPrice("ORGANISATIONS_START", "USD"), { currency: "USD", monthlyPriceCents: 2900 });
  assert.deepEqual(regionalPlanPrice("ORGANISATIONS_ENTERPRISE", "USD"), { currency: "USD", monthlyPriceCents: 79900 });
  assert.equal(regionalPlanPrice("ORGANISATIONS_PRO", "ASIA"), null);
  assert.equal(Object.hasOwn(REGIONAL_PRICE_BOOKS, "ASIA"), false);
});

test("ORG.2-ORG.4 templates, product authority, announcements and Event Mode fail closed", () => {
  assert.equal(Object.keys(ORGANISATION_TEMPLATES).length, 7);
  assert.equal(organisationTerminology("ASSOCIATION").branchLabel, "Chapter");
  assert.equal(organisationTerminology("unknown").branchLabel, "Location");
  assert.equal(subscriberProductAccess({ serviceEnabled: true, organisationsEnabled: true }, "ORGANISATIONS").allowed, true);
  assert.equal(subscriberProductAccess({ serviceEnabled: true, organisationsEnabled: false }, "ORGANISATIONS").allowed, false);
  assert.deepEqual(validateAnnouncementSurfaces(["RADIO", "DISPLAY", "RADIO"]), ["RADIO", "DISPLAY"]);
  assert.throws(() => validateAnnouncementSurfaces([]), /at least one publication surface/i);
  assert.throws(() => validateAnnouncementSurfaces(["ALL"]), /supported publication surfaces/i);
  assert.equal(canTransitionOrganisationEvent("DRAFT", "READY"), true);
  assert.equal(canTransitionOrganisationEvent("DRAFT", "LIVE"), false);
  assert.equal(canTransitionOrganisationEvent("ENDED", "LIVE"), false);
  assert.throws(() => validateOrganisationEventWindow({ startsAt: "2026-01-02", endsAt: "2026-01-01" }), /after its start/i);
});

test("ORG.5-ORG.10 reuse shared production, rights, display and branch foundations", async () => {
  const [schema, autoDj, podcasts, workspaceRoute, dashboard, migration] = await Promise.all([
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../lib/autodj-targets.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/podcasts/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/organisations/workspace/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/organisations/page.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261113010000_organisations_expansion/migration.sql", import.meta.url), "utf8")
  ]);
  assert.match(autoDj, /ORGANISATIONS_CHANNEL/);
  assert.match(autoDj, /ORGANISATIONS_RADIO/);
  assert.match(podcasts, /PODCAST_PRODUCTS\.ORGANISATIONS_RADIO/);
  assert.match(workspaceRoute, /getActiveOrganisationContext/);
  assert.match(workspaceRoute, /organisationId/);
  assert.match(workspaceRoute, /fallbackAutoDjPolicyId/);
  assert.match(workspaceRoute, /Choose at least one publication surface|validateAnnouncementSurfaces/);
  assert.match(workspaceRoute, /organisationNetworkControlsEnabled/);
  assert.match(dashboard, /dashboard\/digital-signage/);
  assert.match(schema, /model OrganisationBranchAssignment/);
  assert.match(migration, /Ruvanas Organisations QA/);
  assert.doesNotMatch(schema, /model (Donor|Voter|Election|Payroll|Accounting|MembershipRecord|Employee)/);
  assert.equal(organisationNetworkControlsEnabled({ organisationsEnabled: true, planTierNumber: 3 }), false);
  assert.equal(organisationNetworkControlsEnabled({ organisationsEnabled: true, planTierNumber: 4 }), true);
});

test("ORG.6 Studio destinations and ORG.11 beta authority include Organisations", () => {
  const destinations = studioDestinationAvailability({ entitlements: { organisationsEnabled: true }, project: {} }).filter((item) => item.product === "ORGANISATIONS");
  assert.deepEqual(destinations.map((item) => item.key), ["ORGANISATIONS_ANNOUNCEMENT", "ORGANISATIONS_PODCAST", "ORGANISATIONS_EVENT"]);
  assert.ok(destinations.every((item) => item.available));
  assert.equal(studioWorkflowPath({ destination: "ORGANISATIONS_PODCAST", mediaAssetId: "media-1" }), "/dashboard/podcasts?product=ORGANISATIONS&mediaAssetId=media-1");
  assert.ok(BETA_PRODUCTS.some((product) => product.value === "ORGANISATIONS"));
});

test("ORG.12-ORG.13 public education and release boundaries are explicit", async () => {
  const [homepage, howItWorks, navigation, workspace] = await Promise.all([
    readFile(new URL("../app/page.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/how-ruvanas-works.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/user-experience-navigation.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/organisations/workspace/OrganisationsWorkspace.js", import.meta.url), "utf8")
  ]);
  assert.match(homepage, /Six platforms\. One standard/);
  assert.match(homepage, /Ruvanas Organisations/);
  assert.match(howItWorks, /id: "organisations"/);
  assert.match(navigation, /organisationsHome|SUBSCRIBER_PRODUCT_LIST/);
  assert.match(workspace, /Publication surfaces/);
  assert.match(workspace, /Govern communications without storing membership, donor, HR, accounting, election or voter records/);
});

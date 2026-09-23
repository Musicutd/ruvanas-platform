import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildSubscriberHome } from "../lib/subscriber-home.mjs";

const onboarding = { nextAction: { href: "/dashboard/players", label: "Set up a player" } };

test("only a physical Retail account uses the first-shop checklist", () => {
  const retail = buildSubscriberHome({ products: [{ key: "RETAIL", label: "Retail Radio", actionHref: "/dashboard/retail" }], onboarding });
  assert.equal(retail.onboarding, onboarding);
  assert.equal(retail.nextAction.href, "/dashboard/players");

  const online = buildSubscriberHome({ products: [{ key: "ONLINE", label: "Online Radio", actionHref: "/dashboard/radio" }], onboarding });
  assert.equal(online.onboarding, null);
  assert.equal(online.nextAction.href, "/dashboard/radio");
});

test("other and multi-product accounts go to their product workspace", () => {
  const health = buildSubscriberHome({ products: [{ key: "HEALTH", label: "Ruvanas Health", actionHref: "/dashboard/health" }], onboarding });
  assert.equal(health.onboarding, null);
  assert.equal(health.nextAction.href, "/dashboard/health");
  const multi = buildSubscriberHome({ products: [
    { key: "RETAIL", label: "Retail Radio", actionHref: "/dashboard/retail" },
    { key: "FAITH", label: "Ruvanas Faith", actionHref: "/dashboard/faith" }
  ], onboarding });
  assert.equal(multi.onboarding, null);
  assert.equal(multi.nextAction.href, "/dashboard/retail");
  assert.match(multi.nextAction.description, /Choose a product/);
});

test("unavailable service leads to notices, not radio setup", () => {
  const home = buildSubscriberHome({ products: [], onboarding, serviceEnabled: false });
  assert.equal(home.onboarding, null);
  assert.equal(home.nextAction.href, "/dashboard/notifications");
});

test("Retail and Digital Signage expose simple tasks and review before publish", async () => {
  const [retail, productDashboard, signage] = await Promise.all([
    readFile(new URL("../app/dashboard/retail/RetailControlCentre.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/ProductDashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/digital-signage/DigitalSignageConsole.js", import.meta.url), "utf8")
  ]);
  assert.match(retail, /YOUR NEXT STEP/);
  assert.match(retail, /Change shop music/);
  assert.match(productDashboard, /COMMON TASKS/);
  assert.match(signage, /Connect a display/);
  assert.match(signage, /Standard full-screen \(recommended\)/);
  assert.match(signage, /Displays: \{playlist\.devices\.map/);
  assert.match(signage, /Draft saved\. Check the visual/);
});

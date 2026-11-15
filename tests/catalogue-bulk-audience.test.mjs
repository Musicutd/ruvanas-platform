import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { CatalogueBulkAudienceError, parseCatalogueBulkAudience, updateCatalogueTiers, MAX_CATALOGUE_TIER_UPDATES } from "../lib/catalogue-bulk-audience.mjs";
import { catalogueAudienceTier, catalogueTierStorage, parseCatalogueAudience } from "../lib/catalogue-audience.mjs";
import { musicTrackEligibility } from "../lib/media-library-pro.mjs";

const ids = ["cm0000000000000000000001", "cm0000000000000000000002"];
const actor = { id: "cm0000000000000000000003", role: "SUPER_ADMIN" };
const input = (minimumCatalogueLevel = "ALL", trackIds = ids) => ({ trackIds, minimumCatalogueLevel, rightsConfirmed: true });
const initialTrack = (id, extra = {}) => ({ id, minimumCatalogueLevel: "PREMIUM", catalogueAllTiers: false, catalogueProvider: null, distributorItems: [],
  status: "READY", permittedUses: ["RETAIL_RADIO"], permittedTerritories: "MT", rightsReviewStatus: "APPROVED", licenceExpiresAt: null,
  mediaAsset: { libraryType: "RUVANAS_CATALOGUE", organisationId: null, mediaType: "MUSIC", status: "READY", licensedCatalogue: false }, ...extra });

function fixture(rows = ids.map(id => initialTrack(id)), { failAudit = false, racedCount = null } = {}) {
  let saved = structuredClone(rows), audits = [], attempts = 0;
  const db = { $transaction: async (operation, options) => {
    attempts++;
    assert.equal(options.isolationLevel, "Serializable");
    const pending = structuredClone(saved), pendingAudits = [];
    const matches = (track, where) => where.id.in.includes(track.id) && track.status !== "ARCHIVED" && track.mediaAsset.libraryType === "RUVANAS_CATALOGUE" && track.mediaAsset.organisationId === null && track.mediaAsset.mediaType === "MUSIC" && !["ARCHIVED", "DELETED"].includes(track.mediaAsset.status);
    const tx = {
      track: {
        findMany: async ({ where }) => {
          assert.deepEqual(where.mediaAsset, { libraryType: "RUVANAS_CATALOGUE", organisationId: null, mediaType: "MUSIC", status: { notIn: ["ARCHIVED", "DELETED"] } });
          return pending.filter(track => matches(track, where));
        },
        updateMany: async ({ where, data }) => {
          assert.deepEqual(Object.keys(data).sort(), ["catalogueAllTiers", "minimumCatalogueLevel"]);
          const matched = pending.filter(track => matches(track, where));
          for (const row of matched) Object.assign(row, data);
          return { count: racedCount ?? matched.length };
        }
      },
      auditLog: { create: async ({ data }) => { if (failAudit) throw new Error("Audit unavailable"); pendingAudits.push(data); } }
    };
    const result = await operation(tx);
    saved = pending; audits.push(...pendingAudits);
    return result;
  } };
  return { db, saved: () => saved, audits: () => audits, attempts: () => attempts };
}

test("all-tier choice is explicit and backward-compatible, never a reinterpretation of NONE", () => {
  assert.equal(parseCatalogueAudience({ minimumCatalogueLevel: "ALL", permittedUses: ["RETAIL_RADIO"], permittedTerritories: "MT" }).ok, true);
  assert.deepEqual(catalogueTierStorage("ALL"), { minimumCatalogueLevel: "FOCUSED", catalogueAllTiers: true });
  assert.deepEqual(catalogueTierStorage("NONE"), { minimumCatalogueLevel: "NONE", catalogueAllTiers: false });
  assert.equal(catalogueAudienceTier({ minimumCatalogueLevel: "NONE" }), "FOCUSED");
  assert.equal(catalogueAudienceTier({ minimumCatalogueLevel: "FOCUSED", catalogueAllTiers: true }), "ALL");
  assert.equal(catalogueAudienceTier({ minimumCatalogueLevel: "PREMIUM", catalogueAllTiers: true }), "PREMIUM");
  assert.equal(parseCatalogueAudience({ minimumCatalogueLevel: "NONE", permittedUses: ["RETAIL_RADIO"], permittedTerritories: "MT" }).ok, false);
});

test("bulk payload is bounded, unique, explicit and cannot change unrelated rights", () => {
  for (const value of [input("NONE"), input("ALL", []), input("ALL", [ids[0], ids[0]]), { ...input(), rightsConfirmed: false }, { ...input(), permittedUses: ["ONLINE_RADIO"] }, input("ALL", Array.from({ length: MAX_CATALOGUE_TIER_UPDATES + 1 }, (_, i) => `cm${String(i).padStart(23, "0")}`))]) {
    assert.equal(parseCatalogueBulkAudience(value).ok, false);
  }
  assert.equal(parseCatalogueBulkAudience(input()).ok, true);
});

test("selected tiers update atomically and preserve all other track and media settings", async () => {
  const extraId = "cm0000000000000000000004";
  const f = fixture([...ids.map(id => initialTrack(id)), initialTrack(extraId)]);
  const before = structuredClone(f.saved());
  const result = await updateCatalogueTiers(f.db, actor, input());
  assert.deepEqual(result, { selectedCount: 2, updatedCount: 2, unchangedCount: 0, minimumCatalogueLevel: "ALL" });
  assert.deepEqual(f.saved().slice(0, 2), before.slice(0, 2).map(track => ({ ...track, minimumCatalogueLevel: "FOCUSED", catalogueAllTiers: true })));
  assert.deepEqual(f.saved()[2], before[2]);
  assert.equal(f.audits().length, 1);
  assert.equal(f.audits()[0].actorUserId, actor.id);
  assert.deepEqual(f.audits()[0].details.after, { minimumCatalogueLevel: "FOCUSED", catalogueAllTiers: true });
  assert.equal((await updateCatalogueTiers(f.db, actor, input())).updatedCount, 0);
  assert.equal(f.audits().length, 1);
  await updateCatalogueTiers(f.db, actor, input("PROFESSIONAL"));
  assert.ok(f.saved().slice(0, 2).every(track => track.minimumCatalogueLevel === "PROFESSIONAL" && track.catalogueAllTiers === false));
});

test("anonymous, subscriber and ordinary admin cannot update any track", async () => {
  for (const identity of [null, { ...actor, role: "USER" }, { ...actor, role: "ADMIN" }]) {
    const f = fixture();
    await assert.rejects(updateCatalogueTiers(f.db, identity, input()), error => error.status === 403);
    assert.equal(f.attempts(), 0);
  }
});

test("missing, tenant-owned, non-music and archived records reject the entire selection", async () => {
  for (const extra of [{ status: "ARCHIVED" }, { mediaAsset: { ...initialTrack(ids[1]).mediaAsset, organisationId: "another-tenant" } }, { mediaAsset: { ...initialTrack(ids[1]).mediaAsset, libraryType: "ORGANISATION_MUSIC" } }, { mediaAsset: { ...initialTrack(ids[1]).mediaAsset, status: "DELETED" } }, { mediaAsset: { ...initialTrack(ids[1]).mediaAsset, mediaType: "PROMO" } }]) {
    const f = fixture([initialTrack(ids[0]), initialTrack(ids[1], extra)]), before = structuredClone(f.saved());
    await assert.rejects(updateCatalogueTiers(f.db, actor, input()), error => error.status === 409);
    assert.deepEqual(f.saved(), before); assert.deepEqual(f.audits(), []);
  }
  const missing = fixture([initialTrack(ids[0])]);
  await assert.rejects(updateCatalogueTiers(missing.db, actor, input()), error => error.status === 409);
});

test("provider minimum scope stays enforced for all-tier and other bulk choices", async () => {
  for (const distributorItems of [[], [{ minimumCatalogueLevel: "PROFESSIONAL" }], [{ minimumCatalogueLevel: "FOCUSED" }, { minimumCatalogueLevel: "PREMIUM" }]]) {
    const f = fixture([initialTrack(ids[0]), initialTrack(ids[1], { catalogueProvider: "PROMO_ONLY", distributorItems })]);
    await assert.rejects(updateCatalogueTiers(f.db, actor, input()), /provider-approved/);
    assert.ok(f.saved().every(track => track.minimumCatalogueLevel === "PREMIUM"));
  }
  const f = fixture([initialTrack(ids[0], { catalogueProvider: "PROMO_ONLY", distributorItems: [{ minimumCatalogueLevel: "FOCUSED" }] })]);
  assert.equal((await updateCatalogueTiers(f.db, actor, input("ALL", [ids[0]]))).updatedCount, 1);
});

test("audit failure or changed row count rolls back every selected update", async () => {
  for (const options of [{ failAudit: true }, { racedCount: 1 }]) {
    const f = fixture(undefined, options), before = structuredClone(f.saved());
    await assert.rejects(updateCatalogueTiers(f.db, actor, input()));
    assert.deepEqual(f.saved(), before); assert.deepEqual(f.audits(), []);
  }
});

test("all-tier storage retains plan, product and territory playback checks", () => {
  const track = initialTrack(ids[0], catalogueTierStorage("ALL"));
  const options = { requiredUse: "RETAIL_RADIO", territory: "MT", licensedCatalogueLevel: "FOCUSED" };
  assert.equal(musicTrackEligibility(track, options).playable, true);
  assert.equal(musicTrackEligibility(track, { ...options, licensedCatalogueLevel: "NONE" }).reason, "CATALOGUE_PLAN_REQUIRED");
  assert.equal(musicTrackEligibility(track, { ...options, requiredUse: "ONLINE_RADIO" }).reason, "USE_NOT_PERMITTED");
  assert.equal(musicTrackEligibility(track, { ...options, territory: "US" }).playable, false);
  assert.equal(musicTrackEligibility({ ...track, licenceExpiresAt: "2000-01-01" }, options).reason, "RIGHTS_WINDOW_INACTIVE");
  const licensed = { ...track, mediaAsset: { ...track.mediaAsset, licensedCatalogue: true, genres: [{ mediaGenre: { name: "Country", slug: "country" } }] } };
  assert.equal(musicTrackEligibility(licensed, options).reason, "CATALOGUE_GENRE_LOCKED");
});

test("route authorizes before reading payload and returns a no-store success response", async () => {
  const source = (await readFile(new URL("../app/api/admin/catalogue/bulk-audience/route.js", import.meta.url), "utf8")).replace(/^import.*;\r?\n/gm, "").replace(/^export /gm, "");
  for (const role of [null, "USER", "ADMIN", "SUPER_ADMIN"]) {
    let reads = 0, updates = 0;
    const dependencies = { NextResponse: { json: (data, options = {}) => ({ data, ...options, status: options.status || 200 }) }, prisma: {},
      requirePlatformAdmin: async () => ({ ok: Boolean(role), user: { ...actor, role } }), accessDenied: () => ({ status: 401 }), CatalogueBulkAudienceError,
      updateCatalogueTiers: async () => { updates++; return { updatedCount: 2 }; } };
    const POST = new Function(...Object.keys(dependencies), `${source}\nreturn POST;`)(...Object.values(dependencies));
    const result = await POST({ json: async () => { reads++; return input(); } });
    assert.equal(result.status, role === "SUPER_ADMIN" ? 200 : role ? 403 : 401);
    assert.equal(reads, role === "SUPER_ADMIN" ? 1 : 0); assert.equal(updates, reads);
    if (role === "SUPER_ADMIN") assert.equal(result.headers["Cache-Control"], "no-store");
  }
});

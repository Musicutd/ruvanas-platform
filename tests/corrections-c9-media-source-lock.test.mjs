import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERAL_STUDIO_MEDIA_ASSET_WHERE,
  lockGeneralStudioMediaAssets
} from "../lib/studio-general-asset-boundary.mjs";

const organisationId = "fictional-organisation";
const privateError = { code: "CORRECTIONS_STUDIO_OUTPUT_BLOCKED", status: 403 };
const changedError = { code: "GENERAL_STUDIO_SOURCE_CHANGED", status: 409 };

function media(id, values = {}) {
  return {
    id, organisationId, libraryType: "ORGANISATION_PROMO",
    audioTakes: [], audioRenderOutputs: [], promoVersions: [], audioClips: [],
    ...values
  };
}

function fixture({ sources, refreshed = sources, allowedIds = sources.map(({ id }) => id), onLock, missingLock, lockedPromoMedia = {} } = {}) {
  const state = { events: [], locks: [], reads: [], allowedIds, snapshot: 0 };
  function inScope(asset, where) {
    return where.id.in.includes(asset.id) && (asset.organisationId === organisationId ||
      (asset.organisationId === null && asset.libraryType === "RUVANAS_CATALOGUE"));
  }
  const database = {
    mediaAsset: { findMany: async (args) => {
      assert.deepEqual(args.where.OR, [
        { organisationId }, { organisationId: null, libraryType: "RUVANAS_CATALOGUE" }
      ]);
      state.reads.push(args);
      if (args.select.audioTakes) {
        assert.equal(args.select.promoVersions.select.id, true);
        assert.equal(args.select.promoVersions.select.mediaAssetId, true);
        const assets = state.snapshot++ === 0 ? sources : refreshed;
        state.events.push(state.snapshot === 1 ? "locate" : "refresh");
        return assets.filter((asset) => inScope(asset, args.where));
      }
      assert.deepEqual(args.where.AND, GENERAL_STUDIO_MEDIA_ASSET_WHERE.AND);
      state.events.push("privacy");
      return refreshed.filter((asset) => inScope(asset, args.where) && state.allowedIds.includes(asset.id))
        .map(({ id }) => ({ id }));
    } },
    $queryRaw: async (parts, ...values) => {
      const sql = String.raw(parts);
      assert.match(sql, /FOR UPDATE/);
      const table = sql.includes('FROM "AudioProject"') ? "project" : sql.includes('FROM "PromoVersion"') ? "promo" : "media";
      const id = values[0];
      state.events.push(`${table}:${id}`);
      state.locks.push({ table, id, sql, values });
      if (onLock) await onLock({ table, id }, state);
      if (missingLock === `${table}:${id}`) return [];
      if (table === "promo") {
        assert.match(sql, /mediaAssetId/);
        const currentMediaId = Object.hasOwn(lockedPromoMedia, id) ? lockedPromoMedia[id] :
          sources.flatMap(({ promoVersions }) => promoVersions).find((version) => version.id === id)?.mediaAssetId;
        if (currentMediaId !== values[1]) return [];
      }
      return [{ id }];
    }
  };
  return { database, state };
}

test("media source locking orders all reverse projects before tenant media and PromoVersions", async () => {
  const sources = [
    media("z-media", {
      audioTakes: [{ projectId: "z-project" }, { projectId: "b-project" }],
      audioRenderOutputs: [{ projectId: "a-project" }],
      promoVersions: [{ id: "z-promo", mediaAssetId: "z-media", renderedAudioVersions: [{ projectId: "c-project" }, { projectId: "b-project" }] }],
      audioClips: [{ track: { projectId: "d-project" } }]
    }),
    media("a-media", { audioRenderOutputs: [{ projectId: "a-project" }],
      promoVersions: [{ id: "a-promo", mediaAssetId: "a-media", renderedAudioVersions: [] }] })
  ];
  const { database, state } = fixture({ sources });
  const allowed = await lockGeneralStudioMediaAssets(database, organisationId, ["z-media", "a-media", "z-media", null]);
  assert.deepEqual(allowed, new Set(["z-media", "a-media"]));
  assert.deepEqual(state.events, [
    "locate", "project:a-project", "project:b-project", "project:c-project", "project:d-project", "project:z-project",
    "media:a-media", "media:z-media", "promo:a-promo", "promo:z-promo", "refresh", "privacy"
  ]);
  assert.deepEqual(state.reads[0].where.id.in, ["a-media", "z-media"]);
  for (const lock of state.locks.filter(({ table }) => table === "project")) {
    assert.doesNotMatch(lock.sql, /organisationId/);
    assert.equal(lock.values.length, 1);
  }
  for (const lock of state.locks.filter(({ table }) => table === "media")) {
    assert.match(lock.sql, /organisationId/);
    assert.equal(lock.values[1], organisationId);
  }
  assert.deepEqual(state.locks.filter(({ table }) => table === "promo").map(({ values }) => values),
    [["a-promo", "a-media"], ["z-promo", "z-media"]]);
});

test("an older output also locks the project found through its PromoVersion render", async () => {
  const sources = [media("older-output", {
    promoVersions: [{ id: "older-promo", mediaAssetId: "older-output", renderedAudioVersions: [{ projectId: "later-render-project" }] }]
  })];
  const { database, state } = fixture({ sources });
  await lockGeneralStudioMediaAssets(database, organisationId, ["older-output"]);
  assert.deepEqual(state.events, [
    "locate", "project:later-render-project", "media:older-output", "promo:older-promo", "refresh", "privacy"
  ]);
});

test("tenant media locks a historically associated foreign project ID before its privacy check", async () => {
  const sources = [media("tenant-output", { audioTakes: [{ projectId: "historical-foreign-project" }] })];
  const { database, state } = fixture({ sources, allowedIds: [] });
  await assert.rejects(lockGeneralStudioMediaAssets(database, organisationId, ["tenant-output"]), privateError);
  assert.equal(state.locks[0].id, "historical-foreign-project");
  assert.deepEqual(state.locks[0].values, ["historical-foreign-project"]);
  assert.equal(state.events.at(-1), "privacy");
});

test("media made private while waiting for locks is rejected by the fresh privacy predicate", async () => {
  const sources = [media("output", { audioRenderOutputs: [{ projectId: "shared-project" }] })];
  const { database, state } = fixture({ sources, onLock: ({ table }, current) => {
    if (table === "project") current.allowedIds = [];
  } });
  await assert.rejects(lockGeneralStudioMediaAssets(database, organisationId, ["output"]), privateError);
  assert.deepEqual(state.events, ["locate", "project:shared-project", "media:output", "refresh", "privacy"]);
});

test("a project added during lock acquisition fails closed without reversing the lock order", async () => {
  const sources = [media("output", { audioTakes: [{ projectId: "original-project" }] })];
  const refreshed = [media("output", {
    audioTakes: [{ projectId: "original-project" }],
    audioClips: [{ track: { projectId: "new-project" } }]
  })];
  const { database, state } = fixture({ sources, refreshed });
  await assert.rejects(lockGeneralStudioMediaAssets(database, organisationId, ["output"]), changedError);
  assert.deepEqual(state.events, ["locate", "project:original-project", "media:output", "refresh"]);
  assert.ok(!state.locks.some(({ id }) => id === "new-project"));
});

test("a promo-only private render discovered after its PromoVersion lock fails closed", async () => {
  const version = { id: "output-promo", mediaAssetId: "output", renderedAudioVersions: [] };
  const sources = [media("output", { promoVersions: [version] })];
  const refreshed = [media("output", { promoVersions: [{ ...version,
    renderedAudioVersions: [{ projectId: "new-private-render-project" }] }] })];
  const { database, state } = fixture({ sources, refreshed });
  await assert.rejects(lockGeneralStudioMediaAssets(database, organisationId, ["output"]), changedError);
  assert.deepEqual(state.events, ["locate", "media:output", "promo:output-promo", "refresh"]);
  assert.ok(!state.locks.some(({ id }) => id === "new-private-render-project"));
});

test("a PromoVersion's missing or changed locked media link fails closed before refreshing", async (t) => {
  const sources = [media("output", { promoVersions: [{ id: "output-promo", mediaAssetId: "output", renderedAudioVersions: [] }] })];
  for (const [label, values] of [
    ["missing row", { missingLock: "promo:output-promo" }],
    ["changed media link", { lockedPromoMedia: { "output-promo": "different-media" } }]
  ]) {
    await t.test(label, async () => {
      const { database, state } = fixture({ sources, ...values });
      await assert.rejects(lockGeneralStudioMediaAssets(database, organisationId, ["output"]), changedError);
      assert.deepEqual(state.events, ["locate", "media:output", "promo:output-promo"]);
    });
  }
});

test("a changed PromoVersion ID set or media link in the refreshed source fails closed", async (t) => {
  const version = { id: "original-promo", mediaAssetId: "output", renderedAudioVersions: [] };
  const sources = [media("output", { promoVersions: [version] })];
  for (const [label, promoVersions] of [
    ["added", [version, { ...version, id: "new-promo" }]],
    ["removed", []],
    ["replaced", [{ ...version, id: "replacement-promo" }]],
    ["changed media link", [{ ...version, mediaAssetId: "different-media" }]]
  ]) {
    await t.test(label, async () => {
      const { database, state } = fixture({ sources, refreshed: [media("output", { promoVersions })] });
      await assert.rejects(lockGeneralStudioMediaAssets(database, organisationId, ["output"]), changedError);
      assert.deepEqual(state.events, ["locate", "media:output", "promo:original-promo", "refresh"]);
    });
  }
});

test("a removed or replaced reverse project association also requires a new source decision", async (t) => {
  const sources = [media("output", { audioRenderOutputs: [{ projectId: "original-project" }] })];
  for (const projects of [[], [{ projectId: "replacement-project" }]]) {
    await t.test(projects.length ? "replaced" : "removed", async () => {
      const { database, state } = fixture({ sources, refreshed: [media("output", { audioRenderOutputs: projects })] });
      await assert.rejects(lockGeneralStudioMediaAssets(database, organisationId, ["output"]), changedError);
      assert.equal(state.events.at(-1), "refresh");
    });
  }
});

test("source identity and ownership changes after locating fail closed", async (t) => {
  for (const [label, replacement] of [
    ["missing identity", []],
    ["different identity", [media("different-output")]],
    ["foreign owner", [media("output", { organisationId: "foreign-organisation" })]],
    ["catalogue owner", [media("output", { organisationId: null, libraryType: "RUVANAS_CATALOGUE" })]],
    ["changed library identity", [media("output", { libraryType: "ORGANISATION_RECORDING" })]]
  ]) {
    await t.test(label, async () => {
      const { database, state } = fixture({ sources: [media("output")], refreshed: replacement });
      await assert.rejects(lockGeneralStudioMediaAssets(database, organisationId, ["output"]), changedError);
      assert.deepEqual(state.events, ["locate", "media:output", "refresh"]);
    });
  }
});

test("tenant and licensed global media stay usable without locking catalogue projects or PromoVersions", async () => {
  const sources = [
    media("tenant-output"),
    media("catalogue", { organisationId: null, libraryType: "RUVANAS_CATALOGUE",
      audioTakes: [{ projectId: "private-catalogue-reuse" }],
      audioRenderOutputs: [{ projectId: "private-catalogue-output" }],
      promoVersions: [{ id: "catalogue-promo", mediaAssetId: "catalogue",
        renderedAudioVersions: [{ projectId: "private-promo-only-catalogue-project" }] }] })
  ];
  const refreshed = [sources[0], { ...sources[1], audioTakes: [{ projectId: "new-private-catalogue-reuse" }],
    promoVersions: [{ id: "new-catalogue-promo", mediaAssetId: "catalogue", renderedAudioVersions: [] }] }];
  const { database, state } = fixture({ sources, refreshed });
  assert.deepEqual(await lockGeneralStudioMediaAssets(database, organisationId, ["catalogue", "tenant-output"]),
    new Set(["tenant-output", "catalogue"]));
  assert.deepEqual(state.events, ["locate", "media:tenant-output", "refresh", "privacy"]);
});

test("missing, foreign and non-catalogue global sources are denied before any lock", async (t) => {
  for (const [label, sources] of [
    ["missing", []],
    ["foreign", [media("output", { organisationId: "foreign-organisation" })]],
    ["foreign catalogue", [media("output", { organisationId: "foreign-organisation", libraryType: "RUVANAS_CATALOGUE" })]],
    ["unlicensed global", [media("output", { organisationId: null })]]
  ]) {
    await t.test(label, async () => {
      const { database, state } = fixture({ sources });
      await assert.rejects(lockGeneralStudioMediaAssets(database, organisationId, ["output"]), privateError);
      assert.deepEqual(state.events, ["locate"]);
    });
  }
});

test("disappearing project and media rows fail closed during lock acquisition", async (t) => {
  const sources = [media("output", { audioClips: [{ track: { projectId: "source-project" } }] })];
  for (const missingLock of ["project:source-project", "media:output"]) {
    await t.test(missingLock, async () => {
      const { database, state } = fixture({ sources, missingLock });
      await assert.rejects(lockGeneralStudioMediaAssets(database, organisationId, ["output"]), changedError);
      assert.equal(state.events.at(-1), missingLock);
    });
  }
});

test("an empty media decision takes no locks and performs no source reads", async () => {
  const { database, state } = fixture({ sources: [] });
  assert.deepEqual(await lockGeneralStudioMediaAssets(database, organisationId, [null, undefined, ""]), new Set());
  assert.deepEqual(state.events, []);
});

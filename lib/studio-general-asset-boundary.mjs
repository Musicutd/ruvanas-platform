// General Studio may use an organisation's ordinary media, but it must never
// turn supervised Corrections sources or renders into a public/live shortcut.
// A project remains private after a session is completed or a new revision is
// submitted. An asset used by both ordinary and Corrections projects is private.
const protectedProject = {
  OR: [
    { correctionsStudioSessions: { some: {} } },
    { correctionsSubmissions: { some: {} } },
    // A C3 staff submission can pin a render without a supervised session
    // or a studioProjectId on the submission itself. Its source project must
    // still be private in ordinary Studio.
    { renders: { some: { correctionsSubmissions: { some: {} } } } }
  ]
};

// Reuse this at the database query boundary of the older School Audio Lab
// routes. Checking a project after it has been loaded is too late for list
// responses and destructive take cleanup.
export const GENERAL_STUDIO_AUDIO_PROJECT_WHERE = { NOT: protectedProject };

const protectedAssetUse = [
  { audioTakes: { some: { project: { is: protectedProject } } } },
  { audioRenderOutputs: { some: { project: { is: protectedProject } } } },
  // C3 staff submissions may use a normal Studio project rather than a
  // supervised C4 session; the submitted render is still private Inside media.
  { audioRenderOutputs: { some: { correctionsSubmissions: { some: {} } } } },
  // Some Studio renders publish through a PromoVersion rather than the
  // AudioRender.outputMediaAsset relation. Guard that output media too.
  { promoVersions: { some: { renderedAudioVersions: { some: { OR: [
    { project: { is: protectedProject } },
    { correctionsSubmissions: { some: {} } }
  ] } } } } },
  { audioClips: { some: { track: { is: { project: { is: protectedProject } } } } } },
  { correctionsRehabContent: { some: {} } },
  { correctionsAnnouncements: { some: {} } },
  { correctionsNetworkAudioDistributions: { some: {} } }
];

// Use a top-level AND so this can be spread alongside an existing OR for
// organisation media versus licensed global catalogue. Global catalogue media
// remains available to the existing six products even when it is also used as
// a source clip in a private Corrections project.
export const GENERAL_STUDIO_MEDIA_ASSET_WHERE = {
  AND: [{
    OR: [
      { organisationId: null },
      { NOT: { OR: protectedAssetUse } }
    ]
  }]
};

function unavailable() {
  return Object.assign(new Error("Private Ruvanas Inside media is not available in general Studio."), {
    status: 403,
    code: "CORRECTIONS_STUDIO_OUTPUT_BLOCKED"
  });
}

export async function assertGeneralStudioAudioProject(database, organisationId, projectId) {
  if (!projectId || !await database.audioProject.findFirst({
    where: { id: projectId, organisationId, ...GENERAL_STUDIO_AUDIO_PROJECT_WHERE },
    select: { id: true }
  })) throw unavailable();
}

// C3 submission locks this project row before it makes a render private. A
// general Studio write must take the same lock, then evaluate the private
// predicate against the state committed by whichever transaction went first.
export async function lockGeneralStudioAudioProject(tx, organisationId, projectId) {
  if (!projectId) throw unavailable();
  const rows = await tx.$queryRaw`SELECT "id" FROM "AudioProject" WHERE "id" = ${projectId} AND "organisationId" = ${organisationId} FOR UPDATE`;
  if (rows.length !== 1) throw unavailable();
  const project = await tx.audioProject.findFirst({
    where: { id: projectId, organisationId, ...GENERAL_STUDIO_AUDIO_PROJECT_WHERE }
  });
  if (!project) throw unavailable();
  return project;
}

export async function generalStudioMediaAssetIds(database, organisationId, assetIds) {
  const ids = [...new Set(assetIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const assets = await database.mediaAsset.findMany({
    where: { id: { in: ids }, organisationId, ...GENERAL_STUDIO_MEDIA_ASSET_WHERE },
    select: { id: true }
  });
  return new Set(assets.map(({ id }) => id));
}

export async function generalStudioUsableMediaAssetIds(database, organisationId, assetIds) {
  const ids = [...new Set(assetIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const assets = await database.mediaAsset.findMany({
    where: {
      id: { in: ids },
      OR: [{ organisationId }, { organisationId: null, libraryType: "RUVANAS_CATALOGUE" }],
      ...GENERAL_STUDIO_MEDIA_ASSET_WHERE
    },
    select: { id: true }
  });
  return new Set(assets.map(({ id }) => id));
}

const mediaSourceLockSelect = {
  id: true, organisationId: true, libraryType: true,
  audioTakes: { select: { projectId: true } },
  audioRenderOutputs: { select: { projectId: true } },
  promoVersions: { select: { id: true, mediaAssetId: true, renderedAudioVersions: { select: { projectId: true } } } },
  audioClips: { select: { track: { select: { projectId: true } } } }
};

function mediaSourceChanged() {
  return Object.assign(new Error("The selected Studio source changed. Refresh and try again."), {
    status: 409,
    code: "GENERAL_STUDIO_SOURCE_CHANGED"
  });
}

function mediaSourceProjectIds(asset) {
  return [...new Set([
    ...asset.audioTakes.map(({ projectId }) => projectId),
    ...asset.audioRenderOutputs.map(({ projectId }) => projectId),
    ...asset.promoVersions.flatMap(({ renderedAudioVersions }) => renderedAudioVersions.map(({ projectId }) => projectId)),
    ...asset.audioClips.map(({ track }) => track.projectId)
  ])].sort();
}

function mediaSourcePromoLinks(asset) {
  return asset.promoVersions.map(({ id, mediaAssetId }) => [id, mediaAssetId])
    .sort(([left], [right]) => left.localeCompare(right));
}

// Call inside a READ COMMITTED transaction. A C3 submission may make an older
// output private through any project that shares its media; a C4 attachment
// may add a new private use through the media's foreign key. Lock every known
// project before tenant media and its PromoVersions, then reject newly
// discovered projects instead of reversing Corrections' lock order. The promo
// locks also serialize renders that reference only outputPromoVersionId.
export async function lockGeneralStudioMediaAssets(tx, organisationId, assetIds) {
  const ids = [...new Set(assetIds.filter(Boolean))].sort();
  if (!ids.length) return new Set();
  const where = {
    id: { in: ids },
    OR: [{ organisationId }, { organisationId: null, libraryType: "RUVANAS_CATALOGUE" }]
  };
  const sources = await tx.mediaAsset.findMany({ where, select: mediaSourceLockSelect });
  const original = new Map(sources.map((asset) => [asset.id, asset]));
  if (original.size !== ids.length || ids.some((id) => !original.has(id))) throw unavailable();
  const tenantSources = sources.filter((asset) => asset.organisationId === organisationId);
  const promoLinks = [...new Map(tenantSources.flatMap((asset) => asset.promoVersions.map((version) => {
    if (!version.id || version.mediaAssetId !== asset.id) throw mediaSourceChanged();
    return [version.id, version.mediaAssetId];
  })))].sort(([left], [right]) => left.localeCompare(right));
  const projectIds = [...new Set(tenantSources.flatMap(mediaSourceProjectIds))].sort();
  for (const projectId of projectIds) {
    // These IDs came only from scoped media. Historical cross-organisation
    // associations still need the actual project lock before privacy is read.
    const rows = await tx.$queryRaw`SELECT "id" FROM "AudioProject" WHERE "id" = ${projectId} FOR UPDATE`;
    if (rows.length !== 1) throw mediaSourceChanged();
  }
  for (const mediaAssetId of tenantSources.map(({ id }) => id).sort()) {
    const rows = await tx.$queryRaw`SELECT "id" FROM "MediaAsset" WHERE "id" = ${mediaAssetId} AND "organisationId" = ${organisationId} FOR UPDATE`;
    if (rows.length !== 1) throw mediaSourceChanged();
  }
  for (const [promoVersionId, mediaAssetId] of promoLinks) {
    const rows = await tx.$queryRaw`SELECT "id" FROM "PromoVersion" WHERE "id" = ${promoVersionId} AND "mediaAssetId" = ${mediaAssetId} FOR UPDATE`;
    if (rows.length !== 1) throw mediaSourceChanged();
  }
  const current = await tx.mediaAsset.findMany({ where, select: mediaSourceLockSelect });
  const refreshed = new Map(current.map((asset) => [asset.id, asset]));
  if (refreshed.size !== ids.length || ids.some((id) => !refreshed.has(id))) throw mediaSourceChanged();
  for (const asset of sources) {
    const fresh = refreshed.get(asset.id);
    if (fresh.organisationId !== asset.organisationId || fresh.libraryType !== asset.libraryType ||
        (asset.organisationId === organisationId &&
          (JSON.stringify(mediaSourceProjectIds(fresh)) !== JSON.stringify(mediaSourceProjectIds(asset)) ||
            JSON.stringify(mediaSourcePromoLinks(fresh)) !== JSON.stringify(mediaSourcePromoLinks(asset))))) throw mediaSourceChanged();
  }
  // Catalogue media stays shared even when reused by a private project.
  const allowed = await generalStudioUsableMediaAssetIds(tx, organisationId, ids);
  if (allowed.size !== ids.length) throw unavailable();
  return allowed;
}

export async function assertGeneralStudioMediaAsset(database, organisationId, assetId) {
  if (!assetId || !(await generalStudioMediaAssetIds(database, organisationId, [assetId])).has(assetId)) throw unavailable();
}

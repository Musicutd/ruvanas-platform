import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { GENERAL_RIGHTS_VISIBILITY_SCOPE } from "../../lib/rights-royalty.mjs";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

async function api(path, { method = "GET", cookie, body } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { origin: baseUrl, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
}

test("generic rights routes exclude private Inside evidence while retaining ordinary and safe legacy exports", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 rights-report integration runs only against the exact disposable CI database.");
  }

  const db = new PrismaClient();
  const suffix = randomUUID();
  let planId;
  try {
    const plan = await db.plan.create({ data: {
      name: `Fictional C9 rights ${suffix}`, code: `C9_RIGHTS_${suffix}`, productFamily: "ONLINE", tierNumber: 1,
      monthlyPriceCents: 0, storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128,
      onlineRadioEnabled: true, stationLimit: 1
    } });
    planId = plan.id;

    async function makeOrganisation(label) {
      const organisation = await db.organisation.create({ data: {
        name: `Fictional C9 ${label} ${suffix}`, slug: `c9-rights-${label}-${suffix}`
      } });
      const password = `CI-only-${randomUUID()}!`;
      const user = await db.user.create({ data: {
        email: `c9-rights-${label}-${suffix}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), role: "OWNER"
      } });
      await db.organisationMember.create({ data: { organisationId: organisation.id, userId: user.id, role: "OWNER" } });
      await db.subscription.create({ data: { organisationId: organisation.id, planId, status: "ACTIVE" } });
      const login = await api("/api/auth/login", { method: "POST", body: { email: user.email, password } });
      assert.equal(login.status, 200, await login.clone().text());
      const cookie = login.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      return { organisation, user, cookie };
    }

    async function makeAssetAndTrack(organisationId, label, permittedUses) {
      const media = await db.mediaAsset.create({ data: {
        organisationId, libraryType: "ORGANISATION_MUSIC", name: label, originalName: `${label}.mp3`,
        storageKey: `c9-rights/${suffix}/${label}.mp3`, mimeType: "audio/mpeg", sizeBytes: 1024n,
        durationSeconds: 180, mediaType: "MUSIC", status: "READY"
      } });
      const track = await db.track.create({ data: {
        mediaAssetId: media.id, title: label, artist: "Fictional Artist", status: "READY",
        permittedUses, rightsReviewStatus: "APPROVED", rightsHolder: "Fictional Holder"
      } });
      return { media, track };
    }

    async function createLegacyJob({ organisationId, userId, authorityId, csvContent, dates }) {
      const hash = createHash("sha256").update(csvContent).digest("hex");
      const job = await db.reportExportJob.create({ data: {
        organisationId, requestedByUserId: userId, reportType: "RIGHTS_ROYALTY_USAGE_CSV", status: "READY",
        filters: { authorityId, from: dates.from, to: dates.to, attestationAccepted: true },
        csvContent, contentSha256: hash, rowCount: 1, expiresAt: new Date(Date.now() + 86_400_000)
      } });
      await db.rightsReportAttestation.create({ data: {
        organisationId, authorityId, reportExportJobId: job.id, attestedByUserId: userId,
        statement: "Fictional CI legacy rights attestation", periodFrom: new Date(`${dates.from}T00:00:00Z`),
        periodTo: new Date(`${dates.to}T00:00:00Z`), rowCount: 1, contentSha256: hash
      } });
      return job;
    }

    const mixed = await makeOrganisation("mixed");
    const normalLocation = await db.location.create({ data: {
      organisationId: mixed.organisation.id, name: "Fictional public studio", slug: `c9-public-${suffix}`,
      zones: { create: { name: "Public zone", slug: "public-zone" } }
    }, include: { zones: true } });
    const privateFacility = await db.location.create({ data: {
      organisationId: mixed.organisation.id, name: "Fictional private facility", slug: `c9-private-${suffix}`,
      correctionsFacility: { create: {} }, zones: { create: { name: "Private wing", slug: "private-wing" } }
    }, include: { zones: true } });
    const normalPlayer = await db.player.create({ data: {
      organisationId: mixed.organisation.id, zoneId: normalLocation.zones[0].id, name: "Fictional public player"
    } });
    const privatePlayer = await db.player.create({ data: {
      organisationId: mixed.organisation.id, zoneId: privateFacility.zones[0].id, name: "Fictional private player"
    } });
    const privateStation = await db.station.create({ data: {
      organisationId: mixed.organisation.id, productFamily: "CORRECTIONS", name: "Fictional Inside station",
      slug: `c9-rights-private-station-${suffix}`, listenerLimit: 10, storageLimitGb: 1,
      maxBitrateKbps: 128
    } });
    const privateChannel = await db.channel.create({ data: {
      organisationId: mixed.organisation.id, stationId: privateStation.id,
      name: "Fictional Inside channel", slug: `c9-rights-private-channel-${suffix}`,
      musicRightsUse: "CORRECTIONS_RADIO"
    } });
    const publicTrack = await makeAssetAndTrack(mixed.organisation.id, "Public Song", ["ONLINE_RADIO"]);
    const privateTrack = await makeAssetAndTrack(mixed.organisation.id, "Private Inside Song", ["CORRECTIONS_RADIO"]);
    const publicLegacyTrack = await makeAssetAndTrack(mixed.organisation.id, "Public Legacy Song", []);
    const privateLegacyTrack = await makeAssetAndTrack(mixed.organisation.id, "Private Legacy Song", []);
    // Empty permittedUses is a legacy state, not proof that the track is
    // public. A private proof must hide it even before a completed rights
    // ledger event exists.
    await db.proofOfPlayEvent.create({ data: {
      clientEventId: randomUUID(), organisationId: mixed.organisation.id,
      playerId: privatePlayer.id, zoneId: privateFacility.zones[0].id,
      scheduleItemId: randomUUID(), itemType: "MUSIC", trackId: privateLegacyTrack.track.id,
      mediaAssetId: privateLegacyTrack.media.id, manifestVersion: "c9-ci-private-legacy",
      programmingSource: "CORRECTIONS_LOCAL", eventType: "STARTED", occurredAt: new Date(),
      playerName: privatePlayer.name, locationName: privateFacility.name,
      zoneName: privateFacility.zones[0].name, trackTitle: privateLegacyTrack.track.title,
      trackArtist: privateLegacyTrack.track.artist
    } });
    const authority = await db.rightsReportingAuthority.create({ data: {
      organisationId: mixed.organisation.id, createdByUserId: mixed.user.id,
      code: `MT${suffix.slice(0, 6).replaceAll("-", "").toUpperCase()}`, name: "Fictional rights authority", territoryCode: "MT"
    } });
    const occurredAt = new Date();
    const dates = {
      from: new Date(occurredAt.getTime() - 86_400_000).toISOString().slice(0, 10),
      to: new Date(occurredAt.getTime() + 86_400_000).toISOString().slice(0, 10)
    };

    async function recordUsage({ player, zone, location, asset, rightsUse, programmingSource, stationId = null, channelId = null }) {
      const eventId = randomUUID();
      const proof = await db.proofOfPlayEvent.create({ data: {
        clientEventId: eventId, organisationId: mixed.organisation.id, playerId: player.id, zoneId: zone.id,
        scheduleItemId: randomUUID(), itemType: "MUSIC", trackId: asset.track.id, mediaAssetId: asset.media.id,
        channelId,
        manifestVersion: "c9-ci", programmingSource, eventType: "COMPLETED", occurredAt,
        positionSeconds: 180, playerName: player.name, locationName: location.name, zoneName: zone.name,
        trackTitle: asset.track.title, trackArtist: asset.track.artist
      } });
      await db.rightsUsageLedgerEvent.create({ data: {
        sourceProofEventId: proof.id, sourceClientEventId: eventId, organisationId: mixed.organisation.id,
        playerId: player.id, stationId, channelId, trackId: asset.track.id, mediaAssetId: asset.media.id,
        occurredAt, receivedAt: new Date(), durationSeconds: 180, territoryCode: "MT", rightsUse,
        trackTitle: asset.track.title, trackArtist: asset.track.artist,
        evidenceSha256: createHash("sha256").update(eventId).digest("hex")
      } });
    }

    await recordUsage({ player: normalPlayer, zone: normalLocation.zones[0], location: normalLocation,
      asset: publicTrack, rightsUse: "ONLINE_RADIO", programmingSource: null });
    await recordUsage({ player: privatePlayer, zone: privateFacility.zones[0], location: privateFacility,
      asset: privateTrack, rightsUse: "CORRECTIONS_RADIO", programmingSource: "CORRECTIONS_CENTRAL" });
    // Historical/mislabelled evidence must also be excluded by the proof's facility.
    await recordUsage({ player: privatePlayer, zone: privateFacility.zones[0], location: privateFacility,
      asset: publicTrack, rightsUse: "ONLINE_RADIO", programmingSource: null });
    // A legacy private channel on a public zone must not leak through the
    // generic report even when the ledger and proof source are mislabelled.
    await recordUsage({ player: normalPlayer, zone: normalLocation.zones[0], location: normalLocation,
      asset: publicTrack, rightsUse: "ONLINE_RADIO", programmingSource: null,
      stationId: privateStation.id, channelId: privateChannel.id });

    const legacyMixed = await createLegacyJob({
      organisationId: mixed.organisation.id, userId: mixed.user.id, authorityId: authority.id,
      csvContent: "Private Inside Song,legacy private CSV", dates
    });
    const workspaceResponse = await api("/api/rights-royalty", { cookie: mixed.cookie });
    assert.equal(workspaceResponse.status, 200, await workspaceResponse.clone().text());
    const workspace = await workspaceResponse.json();
    assert.equal(workspace.summary.ledgerEvents, 1);
    assert.equal(workspace.summary.playedSeconds, 180);
    assert.ok(workspace.tracks.some(({ id }) => id === publicTrack.track.id));
    assert.ok(!workspace.tracks.some(({ id }) => id === privateTrack.track.id));
    assert.ok(workspace.tracks.some(({ id }) => id === publicLegacyTrack.track.id));
    assert.ok(!workspace.tracks.some(({ id }) => id === privateLegacyTrack.track.id));
    assert.ok(!workspace.attestations.some(({ reportExportJobId }) => reportExportJobId === legacyMixed.id));
    assert.equal(workspace.authorities.find(({ id }) => id === authority.id)?._count.attestations, 0);
    for (const path of [
      `/api/reports/rights-royalty/exports/${legacyMixed.id}`,
      `/api/reports/rights-royalty/exports/${legacyMixed.id}/download`
    ]) assert.equal((await api(path, { cookie: mixed.cookie })).status, 404);

    const request = await api("/api/reports/rights-royalty/exports", { method: "POST", cookie: mixed.cookie,
      body: { authorityId: authority.id, ...dates, attestationAccepted: true } });
    assert.equal(request.status, 202, await request.clone().text());
    const { job: queued } = await request.json();
    let exportJob;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await api(queued.statusUrl, { cookie: mixed.cookie });
      assert.equal(response.status, 200, await response.clone().text());
      exportJob = (await response.json()).job;
      if (["READY", "FAILED"].includes(exportJob.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(exportJob.status, "READY", exportJob?.error || "Rights export did not finish");
    const csvResponse = await api(exportJob.downloadUrl, { cookie: mixed.cookie });
    assert.equal(csvResponse.status, 200, await csvResponse.clone().text());
    const csv = await csvResponse.text();
    assert.match(csv, /Public Song/);
    assert.doesNotMatch(csv, /Private Inside Song/);
    assert.match(csv, /"1","180"/);
    const savedJob = await db.reportExportJob.findUnique({ where: { id: queued.id }, select: { filters: true } });
    assert.equal(savedJob.filters.visibilityScope, GENERAL_RIGHTS_VISIBILITY_SCOPE);

    const insidePlan = await db.plan.create({ data: {
      name: `Fictional C9 Inside rights ${suffix}`, code: `C9_INSIDE_RIGHTS_${suffix}`,
      productFamily: "CORRECTIONS", tierNumber: 1, monthlyPriceCents: 0, storageLimitGb: 1,
      listenerLimit: 10, maxBitrateKbps: 128, correctionsRadioEnabled: true, stationLimit: 1
    } });
    await db.subscription.update({ where: { organisationId: mixed.organisation.id }, data: { planId: insidePlan.id } });
    assert.equal((await api("/api/rights-royalty", { cookie: mixed.cookie })).status, 403);
    assert.equal((await api("/api/reports/rights-royalty/exports", { method: "POST", cookie: mixed.cookie,
      body: { authorityId: authority.id, ...dates, attestationAccepted: true } })).status, 403);
    assert.equal((await api(queued.statusUrl, { cookie: mixed.cookie })).status, 403);

    // Pre-Corrections customers retain their existing, unscoped 24-hour exports.
    const ordinary = await makeOrganisation("ordinary");
    const ordinaryAuthority = await db.rightsReportingAuthority.create({ data: {
      organisationId: ordinary.organisation.id, createdByUserId: ordinary.user.id,
      code: `SAFE${suffix.slice(0, 5).replaceAll("-", "").toUpperCase()}`,
      name: "Fictional ordinary authority", territoryCode: "MT"
    } });
    const safeLegacy = await createLegacyJob({ organisationId: ordinary.organisation.id, userId: ordinary.user.id,
      authorityId: ordinaryAuthority.id, csvContent: "Public Song,safe legacy CSV", dates });
    const safeStatus = await api(`/api/reports/rights-royalty/exports/${safeLegacy.id}`, { cookie: ordinary.cookie });
    assert.equal(safeStatus.status, 200, await safeStatus.clone().text());
    const safeDownload = await api(`/api/reports/rights-royalty/exports/${safeLegacy.id}/download`, { cookie: ordinary.cookie });
    assert.equal(safeDownload.status, 200, await safeDownload.clone().text());
    assert.match(await safeDownload.text(), /safe legacy CSV/);
  } finally {
    // The rights ledger and attestation are database-trigger-protected,
    // append-only evidence. This exact disposable CI database is destroyed
    // after the job; never disable its immutability trigger just to clean up.
    await db.$disconnect();
  }
});

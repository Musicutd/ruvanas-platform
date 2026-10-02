import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { createPublicPlaybackToken, publicListenerSessionHash } from "../../lib/public-player.mjs";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

async function api(path, headers = {}) {
  return fetch(`${baseUrl}${path}`, { headers, redirect: "manual" });
}

test("existing public listener authority cannot relay a station after it gains private Inside rights", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 public-player integration runs only against the exact disposable CI database.");
  }

  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let planId;
  try {
    const plan = await db.plan.create({ data: {
      name: `Fictional C9 public plan ${suffix}`, code: `C9_PUBLIC_${suffix}`,
      productFamily: "ONLINE", tierNumber: 1, monthlyPriceCents: 0,
      storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128,
      onlineRadioEnabled: true, stationLimit: 2
    } });
    planId = plan.id;
    const organisation = await db.organisation.create({ data: {
      name: `Fictional C9 public boundary ${suffix}`, slug: `c9-public-${suffix}`
    } });
    organisationId = organisation.id;
    await db.subscription.create({ data: { organisationId, planId, status: "ACTIVE" } });

    async function stationWithListener(productFamily, label) {
      const station = await db.station.create({ data: {
        organisationId, productFamily, name: `Fictional ${label}`,
        slug: `c9-public-${label}-${suffix}`, status: "ACTIVE", publicPlayerEnabled: true,
        stationWebsiteEnabled: true,
        listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128
      } });
      const channel = await db.channel.create({ data: {
        organisationId, stationId: station.id, name: `Fictional ${label} channel`,
        slug: `c9-public-${label}-channel-${suffix}`, status: "ACTIVE"
      } });
      const sessionId = randomUUID();
      const sessionHash = publicListenerSessionHash(sessionId, process.env.SESSION_SECRET);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 300_000);
      await db.publicListenerLease.create({ data: {
        organisationId, stationId: station.id, channelId: channel.id, sessionHash,
        lastSeenAt: now, expiresAt
      } });
      const token = createPublicPlaybackToken({
        organisationId, stationId: station.id, channelId: channel.id, sessionHash,
        issuedAt: now, expiresAt
      }, process.env.SESSION_SECRET);
      const hostname = `c9-${label}-${suffix}.example.com`;
      await db.stationDomain.create({ data: {
        organisationId, stationId: station.id, hostname, status: "ACTIVE",
        verificationToken: `fictional-${suffix}`
      } });
      return { station, channel, sessionId, token, hostname };
    }

    async function expectPublicMetadata({ station, hostname }) {
      assert.equal((await api(`/api/public/stations/${station.slug}`)).status, 200);
      assert.equal((await api(`/listen/${station.slug}`)).status, 200);
      assert.equal((await api(`/embed/${station.slug}`)).status, 200);
      assert.equal((await api(`/api/public/station-websites/${station.slug}`)).status, 200);
      assert.equal((await api(`/api/public/station-websites/domains/${hostname}`)).status, 200);
    }

    async function expectDenied({ station, sessionId, token, hostname }) {
      const stream = await api(`/api/public/player/${station.slug}/stream?listener=${encodeURIComponent(token)}`);
      assert.equal(stream.status, 404);
      assert.equal((await stream.json()).error, "This public station is unavailable.");
      const manifest = await api(`/api/public/player/${station.slug}/manifest`, { "x-ruvanas-listener-session": sessionId });
      assert.equal(manifest.status, 404);
      assert.equal((await manifest.json()).error, "This public station is unavailable.");
      const media = await api(`/api/public/player/${station.slug}/media/fictional-asset?listener=${encodeURIComponent(token)}`);
      assert.equal(media.status, 404);
      assert.equal((await media.json()).error, "This public station is unavailable.");
      assert.equal((await api(`/api/public/stations/${station.slug}`)).status, 404);
      assert.equal((await api(`/listen/${station.slug}`)).status, 404);
      assert.equal((await api(`/embed/${station.slug}`)).status, 404);
      assert.equal((await api(`/api/public/station-websites/${station.slug}`)).status, 404);
      assert.equal((await api(`/api/public/station-websites/domains/${hostname}`)).status, 404);
    }

    const online = await stationWithListener("ONLINE", "online");
    await expectPublicMetadata(online);
    const onlineBefore = await api(`/api/public/player/${online.station.slug}/stream?listener=${encodeURIComponent(online.token)}`);
    assert.equal(onlineBefore.status, 404);
    assert.equal((await onlineBefore.json()).error, "The station stream is unavailable.");
    await db.channel.update({ where: { id: online.channel.id }, data: { musicRightsUse: "CORRECTIONS_RADIO" } });
    await expectDenied(online);

    const location = await db.location.create({ data: {
      organisationId, name: "Fictional public location", slug: `c9-public-location-${suffix}`,
      status: "ACTIVE", zones: { create: { name: "Public zone", slug: "public-zone", status: "ACTIVE" } }
    }, include: { zones: true } });
    const historical = await stationWithListener(null, "historical");
    await db.channelAssignment.create({ data: { channelId: historical.channel.id, zoneId: location.zones[0].id } });
    await expectPublicMetadata(historical);
    const historicalBefore = await api(`/api/public/player/${historical.station.slug}/stream?listener=${encodeURIComponent(historical.token)}`);
    assert.equal(historicalBefore.status, 404);
    assert.equal((await historicalBefore.json()).error, "The station stream is unavailable.");
    // The existing token targets the ordinary channel, but a legacy station
    // cannot remain public once any child is designated for Corrections.
    await db.channel.create({ data: {
      organisationId, stationId: historical.station.id, name: "Fictional private child",
      slug: `c9-public-private-child-${suffix}`, status: "DRAFT", musicRightsUse: "CORRECTIONS_RADIO"
    } });
    await expectDenied(historical);

    const facilityStation = await stationWithListener("ONLINE", "facility");
    const facilityZone = await db.zone.create({ data: {
      locationId: location.id, name: "Facility zone", slug: "facility-zone", status: "ACTIVE"
    } });
    await db.channelAssignment.create({ data: { channelId: facilityStation.channel.id, zoneId: facilityZone.id } });
    await expectPublicMetadata(facilityStation);
    await db.correctionsFacility.create({ data: { locationId: location.id } });
    await expectDenied(facilityStation);
    await db.channel.update({ where: { id: facilityStation.channel.id }, data: { status: "DRAFT" } });
    // An inactive facility child must not make the station's pages public.
    await expectDenied(facilityStation);
  } finally {
    try {
      if (organisationId) await db.organisation.delete({ where: { id: organisationId } });
      if (planId) await db.plan.delete({ where: { id: planId } });
    } finally {
      await db.$disconnect();
    }
  }
});

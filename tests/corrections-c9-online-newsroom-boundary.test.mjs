import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/newsroom/route.js", import.meta.url), "utf8");
const stationBoundary = await readFile(new URL("../lib/general-station-boundary.mjs", import.meta.url), "utf8");
const writeBoundary = await readFile(new URL("../lib/newsroom-write-boundary.mjs", import.meta.url), "utf8");

test("Online Newsroom requires the Online entitlement and offers only ordinary station and channel targets", () => {
  assert.match(route, /function onlineEntitlementRequired\(access\)[\s\S]*access\.entitlements\.onlineRadioEnabled/);
  assert.equal((route.match(/const denied = onlineEntitlementRequired\(access\); if \(denied\) return denied;/g) || []).length, 2);
  assert.match(route, /const onlineStationWhere = GENERAL_STATION_MANAGEMENT_WHERE/);
  assert.match(stationBoundary, /productFamily: \{ not: "CORRECTIONS" \}/);
  assert.match(stationBoundary, /channels: \{[\s\S]*none: \{[\s\S]*musicRightsUse: "CORRECTIONS_RADIO"/);
  assert.match(route, /const onlineChannelWhere = \{[\s\S]*musicRightsUse: \{ not: "CORRECTIONS_RADIO" \}[\s\S]*station: \{ is: onlineStationWhere \}/);
  assert.match(route, /prisma\.station\.findMany\(\{ where: \{ organisationId, status: \{ not: "CANCELLED" \}, \.\.\.onlineStationWhere \}/);
  assert.match(route, /prisma\.channel\.findMany\(\{ where: \{ organisationId, stationId: \{ not: null \}, status: \{ not: "ARCHIVED" \}, \.\.\.onlineChannelWhere \}/);
});

test("Online Newsroom selectors and writes reject private Studio projects and media", () => {
  assert.match(route, /GENERAL_STUDIO_AUDIO_PROJECT_WHERE, GENERAL_STUDIO_MEDIA_ASSET_WHERE/);
  assert.match(route, /prisma\.audioProject\.findMany\(\{ where: \{ organisationId, status: \{ not: "ARCHIVED" \}, \.\.\.GENERAL_STUDIO_AUDIO_PROJECT_WHERE \}/);
  assert.match(route, /prisma\.mediaAsset\.findMany\(\{ where: \{ organisationId, status: "READY", mimeType: \{ startsWith: "audio\/" \}, \.\.\.GENERAL_STUDIO_MEDIA_ASSET_WHERE \}/);
  assert.match(route, /lockVisibleOnlineNewsroomCreateTargets\(tx, \{[\s\S]*stationWhere: onlineStationWhere, channelWhere: onlineChannelWhere/);
  assert.match(writeBoundary, /FROM "Station" WHERE "id" = \$\{stationId\} AND "organisationId" = \$\{organisationId\} FOR UPDATE/);
  assert.match(writeBoundary, /FROM "Channel" WHERE "stationId" = \$\{stationId\} ORDER BY "id" FOR UPDATE/);
  assert.match(writeBoundary, /where: \{ id: stationId, organisationId, status: \{ not: "CANCELLED" \}, \.\.\.stationWhere \}/);
  assert.match(writeBoundary, /where: \{ id: channelId, stationId, organisationId, status: \{ not: "ARCHIVED" \}, \.\.\.channelWhere \}/);
  assert.match(route, /prisma\.audioProject\.findFirst\(\{ where: \{ id: data\.audioProjectId, organisationId, status: \{ not: "ARCHIVED" \}, \.\.\.GENERAL_STUDIO_AUDIO_PROJECT_WHERE \}/);
  assert.match(route, /prisma\.mediaAsset\.findFirst\(\{ where: \{ id: data\.interviewMediaAssetId, organisationId, status: "READY", mimeType: \{ startsWith: "audio\/" \}, \.\.\.GENERAL_STUDIO_MEDIA_ASSET_WHERE \}/);
});

test("Historical current and revision links fail closed before newsroom review or publication", () => {
  assert.match(route, /function visibleOnlineStoryWhere\(organisationId\)/);
  assert.match(route, /stationId: null \}, \{ station: \{ is: onlineStationWhere \} \}/);
  assert.match(route, /channelId: null \}, \{ channel: \{ is: onlineChannelWhere \} \}/);
  assert.match(route, /audioProjectId: null \}, \{ audioProject: \{ is: GENERAL_STUDIO_AUDIO_PROJECT_WHERE \} \}/);
  assert.match(route, /interviewMediaAssetId: null \}, \{ interviewMediaAsset: \{ is: ordinaryMedia \} \}/);
  assert.match(route, /revisions: \{ none: \{ OR: \[[\s\S]*audioProject: \{ isNot: GENERAL_STUDIO_AUDIO_PROJECT_WHERE \}[\s\S]*interviewMediaAsset: \{ isNot: ordinaryMedia \}/);
  assert.equal((route.match(/\.\.\.visibleOnlineStoryWhere\(organisationId\)/g) || []).length, 2);
  assert.match(route, /const story = await onlineStory\(organisationId, data\.storyId\);[\s\S]*if \(!story\) return NextResponse\.json/);
  assert.match(route, /const managerActions = new Set\(\["APPROVE", "REQUEST_CHANGES", "PUBLISH", "ARCHIVE"\]\)/);
});

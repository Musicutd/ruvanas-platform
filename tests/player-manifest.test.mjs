import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlayerManifest,
  deterministicWeightedRotation
} from "../lib/player-manifest.mjs";

const player={id:"player-1",name:"Front desk",zone:{name:"Lobby",location:{name:"Hotel Malta",timezone:"Europe/Malta"},channelAssignments:[{channel:{id:"channel-1"}}]}};
const proofSecret="test-proof-secret-that-is-at-least-32-characters";
const entry=(id,weight=100,overrides={})=>({weight,track:{id,title:`Track ${id}`,artist:"Artist",album:null,status:"READY",mediaAsset:{id:`asset-${id}`,durationSeconds:180,status:"READY",mediaType:"MUSIC",libraryType:"RUVANAS_CATALOGUE",organisationId:null,storageKey:"must-not-leak"},...overrides}});
const resolution={reason:"ZONE_SLOT",scheduleId:"schedule-1",scheduleVersion:2,slotId:"slot-1",musicMode:{id:"mode-1",name:"Morning",slug:"morning",tracks:[entry("a"),entry("b",200)]}};

test("weighted rotation is deterministic for a player and time bucket",()=>{
  const first=deterministicWeightedRotation(resolution.musicMode.tracks,"stable-seed").map((item)=>item.track.id);
  const second=deterministicWeightedRotation(resolution.musicMode.tracks,"stable-seed").map((item)=>item.track.id);
  assert.deepEqual(first,second);
});

test("manifest exposes safe same-origin media URLs without storage keys",()=>{
  const manifest=buildPlayerManifest({player,resolution,proofSecret,instant:new Date("2026-08-31T10:02:00.000Z")});
  assert.equal(manifest.state,"READY");
  assert.equal(manifest.playlist.length,2);
  assert.ok(manifest.playlist.every((track)=>track.mediaUrl.startsWith("/api/player/media/")));
  assert.ok(manifest.playlist.every((track)=>/^[0-9a-f]{64}$/.test(track.proofToken)));
  assert.ok(manifest.playlist.every((track)=>/^[0-9a-f]{64}$/.test(track.scheduleItemId)));
  assert.equal(JSON.stringify(manifest).includes("must-not-leak"),false);
  assert.equal(manifest.expiresAt,"2026-08-31T10:05:00.000Z");
  assert.equal(manifest.live.streamId,"channel:channel-1");
  assert.equal(manifest.live.crossfadeSeconds,2);
});

test("players on the same channel receive one shared live rotation and refresh position",()=>{
  const first=buildPlayerManifest({player,resolution,proofSecret,instant:new Date("2026-08-31T10:02:00.000Z")});
  const second=buildPlayerManifest({player:{...player,id:"player-2"},resolution,proofSecret,instant:new Date("2026-08-31T10:02:07.000Z")});
  assert.equal(first.version,second.version);
  assert.deepEqual(first.playlist.map((item)=>item.trackId),second.playlist.map((item)=>item.trackId));
  assert.equal(first.live.streamId,second.live.streamId);
  assert.notEqual(first.live.current.offsetSeconds,second.live.current.offsetSeconds);
});

test("AutoDJ manifests preserve live rotation and expose a safe programming source",()=>{
  const autodj={...resolution,reason:"DEFAULT_AUTODJ",scheduleId:null,scheduleVersion:null,slotId:null,sourceLabel:"Continuous AutoDJ",fallbackCause:"SCHEDULE_GAP"};
  const manifest=buildPlayerManifest({player,resolution:autodj,proofSecret,instant:new Date("2026-08-31T10:02:00.000Z")});
  assert.equal(manifest.programmingSource,"DEFAULT_AUTODJ");
  assert.equal(manifest.schedule.source,"DEFAULT_AUTODJ");
  assert.equal(manifest.schedule.fallbackCause,"SCHEDULE_GAP");
  assert.ok(manifest.playlist.every((item)=>item.programmingSource === "DEFAULT_AUTODJ"));
  assert.ok(manifest.playlist.every((item)=>/^[0-9a-f]{64}$/.test(item.programmingSourceProofToken)));
  assert.ok(manifest.live.cycleDurationSeconds > 0);
});

test("manifest includes signed campaign insertions without exposing storage details",()=>{
  const campaignPlayout={insertions:[{
    scheduleItemId:"c".repeat(64),campaignId:"campaign-1",campaignName:"Lunch offer",promoVersionId:"promo-version-1",
    promoName:"Lunch promo",mediaAssetId:"promo-media-1",durationSeconds:20,plannedStart:new Date("2026-08-31T10:04:00.000Z"),
    exactTimeHardStart:false,mandatory:false,priority:"NORMAL",sourceRevision:"revision-1"
  }]};
  const manifest=buildPlayerManifest({player,resolution,campaignPlayout,proofSecret,instant:new Date("2026-08-31T10:02:00.000Z")});
  assert.equal(manifest.insertions.length,1);
  assert.equal(manifest.insertions[0].itemType,"PROMO");
  assert.equal(manifest.insertions[0].plannedStart,"2026-08-31T10:04:00.000Z");
  assert.match(manifest.insertions[0].proofToken,/^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(manifest).includes("storage"),false);
});

test("manifest includes signed private school announcement insertions",()=>{
  const schoolPlayout={insertions:[{
    scheduleItemId:"d".repeat(64),schoolBroadcastSlotId:"school-slot-1",announcementId:"announcement-1",announcementTitle:"Morning notice",
    promoVersionId:"promo-version-1",mediaAssetId:"promo-media-1",durationSeconds:20,plannedStart:new Date("2026-08-31T10:03:00.000Z"),
    sourceRevision:"school-slot-1:1:school-radio-v1",publicationRevision:1
  }]};
  const manifest=buildPlayerManifest({player,resolution,schoolPlayout,proofSecret,instant:new Date("2026-08-31T10:02:00.000Z")});
  assert.equal(manifest.insertions.length,1);
  assert.equal(manifest.insertions[0].itemType,"SCHOOL_ANNOUNCEMENT");
  assert.equal(manifest.insertions[0].schoolBroadcastSlotId,"school-slot-1");
  assert.equal(manifest.insertions[0].title,"Morning notice");
  assert.match(manifest.insertions[0].proofToken,/^[0-9a-f]{64}$/);
});

test("unavailable catalogue entries are removed from a manifest",()=>{
  const unsafe={...resolution,musicMode:{...resolution.musicMode,tracks:[entry("draft",100,{status:"DRAFT"}),entry("expired",100,{licenceExpiresAt:new Date("2026-08-30T00:00:00.000Z")}),entry("private",100,{mediaAsset:{id:"asset-private",status:"READY",mediaType:"MUSIC",libraryType:"ORGANISATION_PROMO",organisationId:"org-1"}})]}};
  const manifest=buildPlayerManifest({player,resolution:unsafe,proofSecret,instant:new Date("2026-08-31T10:02:00.000Z")});
  assert.equal(manifest.playlist.length,0);
  assert.equal(manifest.state,"NO_PLAYABLE_TRACKS");
});

test("approved universally-cleared organisation music can use the existing live manifest",()=>{
  const organisationEntry={weight:100,track:{
    id:"organisation-track",title:"Local master",artist:"Local artist",status:"READY",
    rightsHolder:"Organisation 1",rightsReference:"LICENCE-1",rightsBasis:"OWNED_MASTER",
    permittedTerritories:"Worldwide",permittedUses:["RETAIL_RADIO","SCHOOL_RADIO","ONLINE_RADIO"],
    rightsConfirmedAt:new Date("2026-09-01T00:00:00.000Z"),rightsReviewStatus:"APPROVED",
    mediaAsset:{id:"organisation-asset",durationSeconds:180,status:"READY",mediaType:"MUSIC",libraryType:"ORGANISATION_MUSIC",organisationId:"organisation-1"}
  }};
  const organisationResolution={...resolution,musicMode:{...resolution.musicMode,organisationId:"organisation-1",tracks:[organisationEntry]}};
  const manifest=buildPlayerManifest({player,resolution:organisationResolution,proofSecret,instant:new Date("2026-09-04T12:00:00.000Z")});
  assert.equal(manifest.state,"READY");
  assert.equal(manifest.playlist[0].trackId,"organisation-track");
});

test("tracks too short for the live crossfade are not treated as playable",()=>{
  const tooShort={...resolution,musicMode:{...resolution.musicMode,tracks:[entry("short",100,{mediaAsset:{id:"asset-short",durationSeconds:2,status:"READY",mediaType:"MUSIC",libraryType:"RUVANAS_CATALOGUE",organisationId:null}})]}};
  const manifest=buildPlayerManifest({player,resolution:tooShort,proofSecret,instant:new Date("2026-08-31T10:02:00.000Z")});
  assert.equal(manifest.playlist.length,0);
  assert.equal(manifest.state,"NO_PLAYABLE_TRACKS");
});

test("closed and unscheduled players receive an empty plan",()=>{
  const manifest=buildPlayerManifest({player,resolution:{reason:"LOCATION_CLOSED",musicMode:null},proofSecret,instant:new Date("2026-08-31T10:02:00.000Z")});
  assert.equal(manifest.state,"LOCATION_CLOSED");
  assert.equal(manifest.musicMode,null);
  assert.equal(manifest.live,null);
  assert.deepEqual(manifest.playlist,[]);
});

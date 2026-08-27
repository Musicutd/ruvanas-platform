import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlayerManifest,
  deterministicWeightedRotation
} from "../lib/player-manifest.mjs";

const player={id:"player-1",name:"Front desk",zone:{name:"Lobby",location:{name:"Hotel Malta",timezone:"Europe/Malta"}}};
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
  assert.equal(JSON.stringify(manifest).includes("must-not-leak"),false);
  assert.equal(manifest.expiresAt,"2026-08-31T10:05:00.000Z");
});

test("unavailable catalogue entries are removed from a manifest",()=>{
  const unsafe={...resolution,musicMode:{...resolution.musicMode,tracks:[entry("draft",100,{status:"DRAFT"}),entry("private",100,{mediaAsset:{id:"asset-private",status:"READY",mediaType:"MUSIC",libraryType:"ORGANISATION_PROMO",organisationId:"org-1"}})]}};
  const manifest=buildPlayerManifest({player,resolution:unsafe,proofSecret,instant:new Date("2026-08-31T10:02:00.000Z")});
  assert.equal(manifest.playlist.length,0);
  assert.equal(manifest.state,"NO_PLAYABLE_TRACKS");
});

test("closed and unscheduled players receive an empty plan",()=>{
  const manifest=buildPlayerManifest({player,resolution:{reason:"LOCATION_CLOSED",musicMode:null},proofSecret,instant:new Date("2026-08-31T10:02:00.000Z")});
  assert.equal(manifest.state,"LOCATION_CLOSED");
  assert.equal(manifest.musicMode,null);
  assert.deepEqual(manifest.playlist,[]);
});

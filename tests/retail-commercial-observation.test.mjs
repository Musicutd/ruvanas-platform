import test from "node:test";
import assert from "node:assert/strict";
import { retailCommercialObservation } from "../lib/retail-commercial-observation.mjs";
import { buildSubscriberScheduleTimeline } from "../lib/subscriber-stream-audio-timeline.mjs";
const now = new Date("2026-10-29T11:00:00Z"), revision = "a".repeat(64);
const snapshot = { enabled:true, revisionFingerprint:revision,effectiveAt:"2026-10-29T10:00:00Z",validUntil:"2026-10-29T11:00:15Z",
  spots:[{id:"spot",durationSeconds:30,track:{id:"spot",title:"Shop welcome",artist:""}}],rules:[{name:"Welcome",spotIds:["spot"]}] };
const event = { phase:"COMMERCIAL",commercialRevision:revision,commercialRuleName:"Welcome",trackId:"spot",
  presentationAt:now.toISOString(),occurrenceId:`retail-commercial:${revision}:0:2026-10-29:12:00` };
test("commercial evidence requires a fresh exact approval, selected spot and accepted source presentation", () => {
  assert.equal(retailCommercialObservation(snapshot,event,now).track.title,"Shop welcome");
  for (const patch of [{phase:"SCHEDULED"},{trackId:"foreign"},{commercialRevision:"b".repeat(64)},{commercialRuleName:"other"},
    {presentationAt:"2026-10-29T11:00:01Z"},{presentationAt:"2026-10-29T10:59:19Z"},{occurrenceId:"untrusted\ntext"}])
    assert.equal(retailCommercialObservation(snapshot,{...event,...patch},now),null);
  for (const patch of [{enabled:false},{validUntil:now.toISOString()},{effectiveAt:"invalid"},{validUntil:"invalid"},{rules:[]}])
    assert.equal(retailCommercialObservation({...snapshot,...patch},event,now),null);
});
test("approved programme boundaries remain visible even before its media is ready", () => {
  const begin=now.getTime(),end=begin+1800000;
  const timeline=buildSubscriberScheduleTimeline({enabled:true,effectiveAt:new Date(begin-60000).toISOString(),validUntil:new Date(end+60000).toISOString(),
    revisionFingerprint:revision,occurrences:[{id:"programme",label:"Pop",priority:1,startsAt:new Date(begin).toISOString(),endsAt:new Date(end).toISOString(),
      tracks:[{trackId:"music",mediaAssetId:"asset",fingerprint:"unmeasured",genreCodes:["pop"]}],config:{buildMode:"RANDOM_GENRE_POOL",genreCodes:["pop"]}}]},new Map());
  assert.equal(timeline.planAt(begin-1).nextProgrammeBoundaryAtMs,begin);
  assert.equal(timeline.planAt(begin).previousProgrammeBoundaryAtMs,begin);
  assert.equal(timeline.planAt(begin).nextProgrammeBoundaryAtMs,end);
  assert.equal(timeline.planAt(end).previousProgrammeBoundaryAtMs,end);
  assert.equal(timeline.planAt(begin).phase,"RANDOM");
});

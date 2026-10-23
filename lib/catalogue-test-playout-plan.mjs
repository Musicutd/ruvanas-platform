// Fixed, owner-authorized diagnostic only. This does not resolve or publish a
// weekly schedule, choose new catalogue rights, or enable ordinary AutoDJ.
import { catalogueTestProfileForSession } from "./catalogue-test-profiles.mjs";

export const CATALOGUE_TEST_HANDOVER_MODE = "HANDOVER_90_SECONDS";
export const CATALOGUE_TEST_HANDOVER_STATION = "cmvcnbwi20008hr23sd76psi8";
const fail = code => Object.assign(new Error(code), { code });
const id = value => typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\x00-\x1f]/.test(value);

export function buildCatalogueTestPlayoutPlan(session) {
  const profile = catalogueTestProfileForSession(session);
  if (session?.authorized !== true || session.stationId !== CATALOGUE_TEST_HANDOVER_STATION || !id(session.id) ||
      profile?.id !== "FIVE_MINUTES" || session.durationSeconds !== 300 ||
      session.authorization?.testMode !== CATALOGUE_TEST_HANDOVER_MODE ||
      session.plan?.testMode !== CATALOGUE_TEST_HANDOVER_MODE || session.plan?.audioDurationSeconds !== 90 ||
      session.plan?.targetSeconds !== 300 ||
      session.testMode !== undefined && session.testMode !== CATALOGUE_TEST_HANDOVER_MODE ||
      !/^[a-f0-9]{64}$/.test(session.fingerprint || "") || !Array.isArray(session.tracks) || session.tracks.length !== 3) {
    throw fail("TEST_PLAYOUT_AUTHORIZATION_INVALID");
  }
  const ids = new Set(), assets = new Set();
  const phases = ["AUTODJ", "SCHEDULED", "AUTODJ_RETURN"];
  const segments = session.tracks.map((track, index) => {
    if (!id(track?.id) || !id(track.mediaAssetId) || ids.has(track.id) || assets.has(track.mediaAssetId) || track.durationSeconds !== 30) {
      throw fail("TEST_PLAYOUT_PLAN_INVALID");
    }
    ids.add(track.id); assets.add(track.mediaAssetId);
    return Object.freeze({ index, phase: phases[index], trackId: track.id, mediaAssetId: track.mediaAssetId,
      startFrame: index * 30 * 48_000, frameCount: 30 * 48_000, sourceOffsetFrames: 0 });
  });
  return Object.freeze({ mode: CATALOGUE_TEST_HANDOVER_MODE, sessionId: session.id, fingerprint: session.fingerprint,
    durationSeconds: 90, sampleRate: 48_000, channels: 2, totalFrames: 90 * 48_000,
    segments: Object.freeze(segments), diagnosticOnly: true });
}

// A frame can straddle a programme cut; attribution is an encoder-frame map,
// not a claim that a listener heard precisely these per-track byte counts.
export function catalogueTestPlayoutSegmentForFrame(plan, frameStart) {
  if (plan?.mode !== CATALOGUE_TEST_HANDOVER_MODE || !Number.isSafeInteger(frameStart) || frameStart < 0 ||
      frameStart >= plan.totalFrames + 2 * 1152) throw fail("TEST_PLAYOUT_FRAME_INVALID");
  return plan.segments.find(segment => frameStart < segment.startFrame + segment.frameCount) || plan.segments.at(-1);
}

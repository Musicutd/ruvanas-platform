import { musicTrackEligibility } from "./media-library-pro.mjs";
import { LIVE_CHANNEL_CROSSFADE_SECONDS, liveCapableEntries } from "./live-channel-clock.mjs";

export function playableMusicModeEntries(musicMode, instant = new Date(), options = {}) {
  return (musicMode?.tracks || []).filter(({ weight, track }) =>
    Number.isInteger(weight) && weight >= 1 && weight <= 1000 &&
    musicTrackEligibility(track, {
      organisationId: options.organisationId || musicMode?.organisationId,
      requiredUse: options.requiredUse || null,
      territory: options.territory || null,
      instant
    }).playable
  );
}

export function playableLiveMusicModeEntries(musicMode, instant = new Date(), options = {}) {
  return liveCapableEntries(
    playableMusicModeEntries(musicMode, instant, options),
    LIVE_CHANNEL_CROSSFADE_SECONDS
  );
}

export function musicModeIsPlayable(musicMode, instant = new Date(), options = {}) {
  return musicMode?.status === "ACTIVE" && playableLiveMusicModeEntries(musicMode, instant, options).length > 0;
}

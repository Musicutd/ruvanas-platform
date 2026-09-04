import { isCatalogueLicenceCurrent } from "./catalogue-upload.mjs";
import { LIVE_CHANNEL_CROSSFADE_SECONDS, liveCapableEntries } from "./live-channel-clock.mjs";

export function playableMusicModeEntries(musicMode, instant = new Date()) {
  return (musicMode?.tracks || []).filter(({ weight, track }) =>
    Number.isInteger(weight) && weight >= 1 && weight <= 1000 &&
    track?.status === "READY" &&
    track.mediaAsset?.status === "READY" &&
    track.mediaAsset?.mediaType === "MUSIC" &&
    track.mediaAsset?.libraryType === "RUVANAS_CATALOGUE" &&
    track.mediaAsset?.organisationId === null &&
    isCatalogueLicenceCurrent(track.licenceExpiresAt, instant)
  );
}

export function playableLiveMusicModeEntries(musicMode, instant = new Date()) {
  return liveCapableEntries(
    playableMusicModeEntries(musicMode, instant),
    LIVE_CHANNEL_CROSSFADE_SECONDS
  );
}

export function musicModeIsPlayable(musicMode, instant = new Date()) {
  return musicMode?.status === "ACTIVE" && playableLiveMusicModeEntries(musicMode, instant).length > 0;
}

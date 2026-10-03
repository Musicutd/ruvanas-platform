import { GENERAL_STUDIO_CHANNEL_WHERE } from "./studio-general-output-boundary.mjs";

// Simple playlists are an ordinary subscriber tool, not an Inside review or
// scheduling path. A historical event on a private channel also makes the
// playlist name private, even when its rights-use label was never updated.
export const GENERAL_SIMPLE_PLAYLIST_WHERE = {
  rightsUse: { not: "CORRECTIONS_RADIO" },
  subscriberEvents: { none: { channel: { isNot: GENERAL_STUDIO_CHANNEL_WHERE } } }
};

export function buildRetailMusicAreas(programming = {}) {
  const data = programming || {};
  const channels = new Map((data.channels || []).map((channel) => [channel.id, channel]));
  return (data.targets || [])
    .filter((target) => target.type === "ZONE")
    .map((target) => {
      const channel = target.channelId ? channels.get(target.channelId) : null;
      const blocker = !target.channelId
        ? "This area needs one assigned channel before music can be selected."
        : !channel
          ? "The assigned channel is not available. Ask Ruvanas to check this area."
          : channel.assignments.length > 1
            ? "This channel serves more than one area. Use advanced programming or ask Ruvanas to separate the areas."
            : channel.assignments.length === 0
              ? "This channel is not connected to a listening area yet."
            : null;
      return {
        ...target,
        label: `${target.locationName} / ${target.name}`,
        channel: channel || null,
        blocker
      };
    });
}

export function retailMusicSelection(area, musicModes = []) {
  const playableModes = (musicModes || []).filter((mode) => mode.playableTrackCount > 0);
  const currentModeId = area?.channel?.autoDjPolicy?.defaultMusicModeId;
  return {
    modeId: playableModes.some((mode) => mode.id === currentModeId) ? currentModeId : playableModes[0]?.id || "",
    playbackPolicy: area?.channel?.autoDjPolicy?.playbackPolicy || "FOLLOW_LOCATION_HOURS"
  };
}

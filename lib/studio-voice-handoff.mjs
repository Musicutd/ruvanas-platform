export function studioVoiceTrackingUrl(channelId) {
  const id = typeof channelId === "string" ? channelId.trim() : "";
  const query = id ? `?studioChannelId=${encodeURIComponent(id)}` : "";
  return `/dashboard/programming${query}#workspace-production`;
}

export function verifiedStudioVoiceChannel(channels, requestedId) {
  if (typeof requestedId !== "string" || !requestedId) return null;
  return (Array.isArray(channels) ? channels : []).find((channel) => channel.id === requestedId) || null;
}

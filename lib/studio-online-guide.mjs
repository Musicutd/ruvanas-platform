// Subscriber-facing preparation state. This never infers public playback from
// a saved queue, a worker lease or a healthy HTTP response.
export function onlineStudioGuideState(workspace) {
  const channel = workspace?.channels?.find((item) => item.stationId && item.autoDjPolicy?.enabled && item.autoDjPolicy?.state === "ACTIVE") ||
    workspace?.channels?.find((item) => item.stationId) || null;
  const fallbackReady = Boolean(channel?.autoDjPolicy?.enabled && channel.autoDjPolicy.state === "ACTIVE");
  const session = workspace?.sessions?.find((item) => item.channelId === channel?.id && ["ACTIVE", "FALLBACK"].includes(item.status)) || null;
  const readyItems = session?.items?.filter((item) => item.area === "LIVE" && item.status === "READY" && item.rightsReady) || [];
  const encoderConnected = workspace?.manualOutput?.connected === true;

  return {
    channel,
    session,
    readyItemCount: readyItems.length,
    fallbackReady,
    encoderConnected,
    // Even an encoder acknowledgement is not independent listener evidence.
    listenerVerified: false,
    nextStep: !channel || !fallbackReady ? "CHANNEL" : !session || !readyItems.length ? "QUEUE" : "OUTPUT"
  };
}

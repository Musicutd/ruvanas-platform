export function publicRequestOrigin({
  nextOrigin,
  host,
  forwardedHost,
  forwardedProto
}) {
  const resolvedHost = forwardedHost?.split(",")[0]?.trim() || host;
  const fallbackProtocol = nextOrigin ? new URL(nextOrigin).protocol.replace(":", "") : "https";
  const protocol = forwardedProto?.split(",")[0]?.trim() || fallbackProtocol;

  return resolvedHost ? `${protocol}://${resolvedHost}` : nextOrigin;
}


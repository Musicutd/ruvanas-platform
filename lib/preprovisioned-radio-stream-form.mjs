/** The simple Streamerr form assumes both Centova ports match unless explicitly overridden. */
export function manualStreamRegistrationPayload(fields, { differentPort = false } = {}) {
  return {
    centovaUsername: fields.centovaUsername,
    streamUrl: fields.streamUrl,
    serverHost: fields.serverHost,
    sourcePort: fields.sourcePort,
    serverPort: differentPort ? fields.serverPort : fields.sourcePort,
    sourceUsername: fields.sourceUsername,
    sourcePassword: fields.sourcePassword,
    listenerLimit: fields.listenerLimit,
    maxBitrateKbps: fields.maxBitrateKbps
  };
}

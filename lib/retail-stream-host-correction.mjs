// Nonsecret, provider-confirmed correction for this one disconnected pilot.
// This is not a general destination-editing or credential-rotation permission.
export const RETAIL_PILOT_HOST_CORRECTION = Object.freeze({
  organisationId: "cmvmeq5880005lf2knwtw1b93",
  fromHost: "pollux.shoutcast.com",
  toHost: "pollux.shoutca.st",
  port: 8330,
  centovaUsername: "ruvanastestretail",
  streamUrl: "https://ruvanastestretail-radio105network.radioca.st/stream",
  ticket: "74460",
  confirmation: "CORRECT_TEST_RETAIL_HOST_ONLY"
});

export function isRetailPilotHostCorrectionTarget(organisationId, connection, { allowCorrected = false } = {}) {
  const scope = RETAIL_PILOT_HOST_CORRECTION;
  return organisationId === scope.organisationId && connection?.providerKey === "CENTOVA_CAST" &&
    connection.outputCodec === "MP3" && connection.centovaUsername === scope.centovaUsername &&
    connection.serverPort === scope.port && connection.sourcePort === scope.port &&
    connection.streamUrl === scope.streamUrl && !connection.sourceUsername &&
    (connection.serverHost === scope.fromHost || allowCorrected && connection.serverHost === scope.toHost);
}

// Pure, draft-only configuration policy. No DNS, provider, database, worker,
// music-rights, billing or credential verification occurs in this module.
export const RETAIL_SHARED_STREAM_POLICY = Object.freeze({
  productFamily: "RETAIL", mode: "ONE_SHARED_STREAM_PER_SUBSCRIBER",
  outputCount: 1, providerKey: "CENTOVA_CAST", outputCodec: "MP3", maximumExistingOutputs: 2000
});

const messages = Object.freeze({
  INPUT_INVALID: "The Retail stream planning request is invalid.",
  ORGANISATION_REQUIRED: "A valid Retail subscriber organisation is required.",
  SERVICE_INACTIVE: "The Retail subscriber service must be active.",
  RETAIL_NOT_INCLUDED: "Retail Radio must be included in the current service.",
  MULTISTREAM_NOT_SUPPORTED: "Only one shared Retail stream is supported. Enterprise multistream is not enabled.",
  ENTITLEMENTS_INVALID: "The current entitlement limits need review.",
  CONNECTION_INVALID: "Enter valid, explicit Retail provider settings.",
  CREDENTIAL_FIELDS_NOT_ALLOWED: "Pass only whether a credential is configured, never a credential value.",
  PROVIDER_NOT_SUPPORTED: "This draft supports Centova Cast with MP3 only.",
  HOST_INVALID: "Enter a syntactically public DNS host or canonical public IPv4 address.",
  LISTENER_INVALID: "Enter a public HTTPS listener URL without credentials, query or fragment.",
  BITRATE_NOT_ALLOWED: "Choose a bitrate within the current entitlement ceiling.",
  TARGET_RESERVED: "The Test Radio target cannot be reused for Retail onboarding.",
  EXISTING_OUTPUTS_INVALID: "The supplied existing-output inventory needs review.",
  FOREIGN_PROFILE: "The stream profile belongs to another organisation.",
  PROFILE_NOT_EDITABLE: "Only an off, unleased Retail draft profile can be reused.",
  SHARED_STREAM_EXISTS: "This subscriber already has a current Retail stream profile.",
  SOURCE_ALREADY_ASSIGNED: "The provider source or account is already present in the supplied inventory."
});

export class RetailStreamOnboardingError extends Error {
  constructor(reason) {
    super(messages[reason] || messages.INPUT_INVALID);
    this.name = "RetailStreamOnboardingError";
    this.code = `RETAIL_STREAM_${Object.hasOwn(messages, reason) ? reason : "INPUT_INVALID"}`;
  }
}
const deny = reason => { throw new RetailStreamOnboardingError(reason); };
const record = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const identifier = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
const secretKey = key => /password|secret|token|authorization|cookie|private.?key|access.?key|api.?key|credential/i.test(key) && key !== "credentialConfigured";
function noSecrets(value) {
  if (Object.keys(value).some(secretKey)) deny("CREDENTIAL_FIELDS_NOT_ALLOWED");
}
function allowedFields(value, fields, reason) {
  if (!record(value)) deny(reason);
  noSecrets(value);
  if (Object.keys(value).some(key => !fields.has(key))) deny(reason);
}
const inputFields = new Set(["organisationId", "entitlements", "connection", "existingOutputs", "requestedOutputCount"]);
const connectionFields = new Set(["stationId", "organisationId", "productFamily", "providerKey", "outputCodec",
  "streamUrl", "serverHost", "serverPort", "sourcePort", "centovaUsername", "sourceUsername", "bitrateKbps", "credentialConfigured"]);
const outputFields = new Set(["stationId", "organisationId", "productFamily", "status", "providerKey", "serverHost",
  "sourcePort", "centovaUsername", "outboundAutoDjEnabled", "encoderLeaseOwner", "encoderLeaseUntil", "probeEnabled",
  "publicPlayerEnabled", "stationWebsiteEnabled", "sourceConnectionStatus", "streamingProfileCount"]);
const products = new Set(["RETAIL", "SCHOOL", "ONLINE", "HEALTH", "FAITH", "ORGANISATIONS", "CORRECTIONS"]);
const statuses = new Set(["DRAFT", "PENDING_SETUP", "ACTIVE", "PAUSED", "SUSPENDED", "CANCELLED", "ARCHIVED"]);
const terminal = new Set(["CANCELLED", "ARCHIVED"]);
const limitFields = ["stationLimit", "streamLimit", "siteLimit", "displayLimit", "digitalSignageDisplayLimit"];
const port = value => Number.isInteger(value) && value >= 1 && value <= 65535;
const account = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const reservedStation = "cmvcnbwi20008hr23sd76psi8";
const reservedAccounts = new Set(["ruvanastestradio", "ruvanas_test_radio"]);
const reservedSourceHosts = new Set(["pollux.shoutca.st", "88.198.70.25"]);

function publicIpv4(host) {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some(part => !/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255)) return false;
  const [a, b, c] = parts.map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99) ||
    a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}
function publicHost(value) {
  if (typeof value !== "string" || value.length > 254 || !value || /[^A-Za-z0-9.-]/.test(value)) deny("HOST_INVALID");
  const host = value.toLowerCase().replace(/\.$/, "");
  if (host.length > 253 || !host) deny("HOST_INVALID");
  if (/^[0-9.]+$/.test(host)) {
    if (!publicIpv4(host)) deny("HOST_INVALID");
    return host;
  }
  const labels = host.split("."), suffix = labels.at(-1);
  if (labels.length < 2 || !/^[a-z][a-z0-9-]*$/.test(suffix) ||
    labels.some(label => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
    ["localhost", "local", "internal", "invalid", "example", "test", "onion", "home", "lan", "arpa"].includes(suffix)) deny("HOST_INVALID");
  return host;
}
function listener(value) {
  if (typeof value !== "string" || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)) deny("LISTENER_INVALID");
  // Validate the original authority before URL can coerce hexadecimal, octal or
  // shortened IPv4 spellings into a different host.
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (!authority || /[@%\[\]]/.test(authority)) deny("LISTENER_INVALID");
  const pieces = authority.split(":");
  if (pieces.length > 2 || pieces.length === 2 && (!/^[1-9][0-9]{0,4}$/.test(pieces[1]) || !port(Number(pieces[1])))) deny("LISTENER_INVALID");
  let host;
  try { host = publicHost(pieces[0]); } catch { deny("LISTENER_INVALID"); }
  let url;
  try { url = new URL(value); } catch { deny("LISTENER_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.hostname.toLowerCase().replace(/\.$/, "") !== host) deny("LISTENER_INVALID");
  url.hostname = host;
  return { streamUrl: url.href, hostname: host };
}
function canonicalConnection(value, organisationId, ceiling) {
  allowedFields(value, connectionFields, "CONNECTION_INVALID");
  if (value.stationId != null && !identifier(value.stationId) || value.organisationId != null && value.organisationId !== organisationId ||
    value.productFamily != null && value.productFamily !== "RETAIL") deny("CONNECTION_INVALID");
  if (value.providerKey !== "CENTOVA_CAST" || value.outputCodec != null && value.outputCodec !== "MP3") deny("PROVIDER_NOT_SUPPORTED");
  const endpoint = listener(value.streamUrl), serverHost = publicHost(value.serverHost);
  if (!port(value.sourcePort) || value.serverPort != null && !port(value.serverPort) || !account(value.centovaUsername) ||
    typeof value.credentialConfigured !== "boolean") deny("CONNECTION_INVALID");
  if (value.sourceUsername != null && value.sourceUsername !== "" &&
    (typeof value.sourceUsername !== "string" || !/^[A-Za-z0-9_.@-]{1,120}$/.test(value.sourceUsername))) deny("CONNECTION_INVALID");
  if (!Number.isInteger(value.bitrateKbps) || value.bitrateKbps < 8 || value.bitrateKbps > ceiling) deny("BITRATE_NOT_ALLOWED");
  if (value.stationId === reservedStation || reservedAccounts.has(value.centovaUsername.toLowerCase()) ||
    reservedSourceHosts.has(serverHost) && value.sourcePort === 8282 ||
    ["ruvanastestradio-radio105network.radioca.st", "ruvanas_test_radio-radio105network.radioca.st"].includes(endpoint.hostname)) deny("TARGET_RESERVED");
  return { stationId: value.stationId ?? null, providerKey: "CENTOVA_CAST", outputCodec: "MP3", streamUrl: endpoint.streamUrl,
    serverHost, serverPort: value.serverPort ?? null, sourcePort: value.sourcePort,
    centovaUsername: value.centovaUsername, sourceUsername: value.sourceUsername || null,
    bitrateKbps: value.bitrateKbps, credentialConfigured: value.credentialConfigured };
}
function inventory(value, connection, organisationId) {
  if (!Array.isArray(value) || value.length > RETAIL_SHARED_STREAM_POLICY.maximumExistingOutputs) deny("EXISTING_OUTPUTS_INVALID");
  const seen = new Set(); let reused = false;
  for (const row of value) {
    allowedFields(row, outputFields, "EXISTING_OUTPUTS_INVALID");
    if (!identifier(row.stationId) || !identifier(row.organisationId) || !products.has(row.productFamily) || !statuses.has(row.status) || seen.has(row.stationId)) deny("EXISTING_OUTPUTS_INVALID");
    seen.add(row.stationId);
    if (row.providerKey != null && !["CENTOVA_CAST", "GENERIC_HTTP"].includes(row.providerKey) ||
      row.sourcePort != null && !port(row.sourcePort) || row.centovaUsername != null && !account(row.centovaUsername)) deny("EXISTING_OUTPUTS_INVALID");
    let host = null;
    if (row.serverHost != null) {
      try { host = publicHost(row.serverHost); } catch { deny("EXISTING_OUTPUTS_INVALID"); }
    }
    // Legacy/incomplete records cannot establish that a provider source is
    // unassigned. In particular, a missing source port is never inferred from
    // another field or silently treated as a non-collision.
    if (row.providerKey === "CENTOVA_CAST" && (!host || !port(row.sourcePort) || !account(row.centovaUsername)) ||
      host === connection.serverHost && (!row.providerKey || row.providerKey === "CENTOVA_CAST" && (!port(row.sourcePort) || !account(row.centovaUsername)))) deny("EXISTING_OUTPUTS_INVALID");
    if (row.stationId === connection.stationId) {
      if (row.organisationId !== organisationId) deny("FOREIGN_PROFILE");
      if (row.productFamily !== "RETAIL" || row.status !== "DRAFT" || row.outboundAutoDjEnabled !== false ||
        row.encoderLeaseOwner !== null || row.encoderLeaseUntil !== null || row.probeEnabled !== false ||
        row.publicPlayerEnabled !== false || row.stationWebsiteEnabled !== false || row.sourceConnectionStatus !== "DISCONNECTED" ||
        row.streamingProfileCount !== 0) deny("PROFILE_NOT_EDITABLE");
      reused = true;
      continue;
    }
    // Even a terminal row can retain a provider assignment; only the caller's
    // separate audited release workflow may remove it from this inventory.
    if (row.providerKey === "CENTOVA_CAST" && (host === connection.serverHost && row.sourcePort === connection.sourcePort ||
      host === connection.serverHost && row.centovaUsername?.toLowerCase() === connection.centovaUsername.toLowerCase())) deny("SOURCE_ALREADY_ASSIGNED");
    if (row.organisationId === organisationId && row.productFamily === "RETAIL" && !terminal.has(row.status)) deny("SHARED_STREAM_EXISTS");
  }
  return reused;
}

/** Validate a server-scoped draft only. Existing inventory must be fresh and
 * complete and rechecked transactionally before persistence. Syntax does not
 * prove DNS safety, account ownership, uniqueness, rights, cost or live output.
 * sourcePort is mandatory and is never inferred from either listener/server port.
 * Optional site/display/station limits are opaque entitlement metadata, not a
 * commercial tier table and never a multiplier for the single output.
 */
export function retailSharedStreamPlan(input) {
  allowedFields(input, inputFields, "INPUT_INVALID");
  const { organisationId, entitlements, connection, existingOutputs = [], requestedOutputCount = 1 } = input;
  if (!identifier(organisationId)) deny("ORGANISATION_REQUIRED");
  if (!record(entitlements)) deny("ENTITLEMENTS_INVALID");
  noSecrets(entitlements);
  if (entitlements.serviceEnabled !== true) deny("SERVICE_INACTIVE");
  if (entitlements.retailRadioEnabled !== true) deny("RETAIL_NOT_INCLUDED");
  if (requestedOutputCount !== 1) deny("MULTISTREAM_NOT_SUPPORTED");
  const ceiling = entitlements.maxBitrateKbps;
  if (!Number.isInteger(ceiling) || ceiling < 8 || ceiling > 320) deny("ENTITLEMENTS_INVALID");
  const originalEntitlementLimits = {};
  for (const key of limitFields) {
    const value = entitlements[key] ?? null;
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) deny("ENTITLEMENTS_INVALID");
    originalEntitlementLimits[key] = value;
  }
  const config = canonicalConnection(connection, organisationId, ceiling);
  const existingProfileReused = inventory(existingOutputs, config, organisationId);
  const requiresPlanLimitReview = originalEntitlementLimits.siteLimit === null ||
    originalEntitlementLimits.displayLimit === null && originalEntitlementLimits.digitalSignageDisplayLimit === null;
  return {
    status: "DRAFT_VALIDATED_ONLY", planDraftValidation: true, syntaxValidated: true,
    organisationId, productFamily: "RETAIL", mode: RETAIL_SHARED_STREAM_POLICY.mode,
    outputCount: 1, sharedAcrossShops: true, enterpriseMultistreamEnabled: false,
    connection: config, originalEntitlementLimits, maxBitrateKbps: ceiling, limitsAreMetadataOnly: true,
    existingProfileReused, requiresFreshServerRecheck: true, requiresPlanLimitReview,
    canStart: false, outboundAutoDjEnabled: false, probeEnabled: false, publicPlayerEnabled: false,
    stationWebsiteEnabled: false, listenerRequestsEnabled: false, audiencePolicy: "INTERNAL",
    activationAllowed: false, provisioningAllowed: false, workerAllocated: false,
    verification: { dns: false, listener: false, sourceCredential: false, providerOwnership: false,
      globalAssignmentUniqueness: false, musicRights: false, costs: false },
    warnings: ["Draft settings only: no audio, provider account, worker or resource is started or provisioned.",
      ...(!config.credentialConfigured ? ["A source credential is not configured; no credential has been verified."] : []),
      ...(requiresPlanLimitReview ? ["Explicit site/display limits need review; no limits were inferred from stream count."] : [])]
  };
}

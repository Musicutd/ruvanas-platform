// Browser-safe display/request helpers. Never import the database service here.
const invalid = () => { throw new Error("Retail draft details could not be verified. Reload this page before saving."); };
const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
const text = (value, maximum) => typeof value === "string" && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
const numberOrNull = value => value === null || Number.isSafeInteger(value) && value >= 0;
const portOrNull = value => value === null || Number.isInteger(value) && value > 0 && value <= 65535;
const offFields = ["canStart", "probeEnabled", "outboundAutoDjEnabled", "publicPlayerEnabled", "stationWebsiteEnabled", "listenerRequestsEnabled"];
export const RETAIL_STREAM_DRAFT_REQUEST_BYTES = 4096;
function safeListener(value) {
  if (!text(value, 2048) || /[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export function safeRetailStreamSetupView(value, organisationId) {
  if (!id(organisationId) || value?.organisation?.id !== organisationId || !text(value.organisation.name, 200) ||
      typeof value.canSaveDraft !== "boolean" || offFields.some(key => value[key] !== false) || value.audiencePolicy !== "INTERNAL" ||
      typeof value.requiresPlanLimitReview !== "boolean" || !value.entitlements ||
      !["maxBitrateKbps", "listenerLimit", "storageLimitGb", "stationLimit", "streamLimit", "siteLimit", "displayLimit", "digitalSignageDisplayLimit"]
        .every(key => numberOrNull(value.entitlements[key] ?? null))) invalid();
  const station = value.station == null ? null : value.station;
  if (station && (!id(station.id) || !["DRAFT", "PENDING_SETUP", "ACTIVE", "PAUSED", "SUSPENDED", "CANCELLED"].includes(station.status))) invalid();
  if (value.canSaveDraft && station && station.status !== "DRAFT") invalid();
  // Protected/blocked legacy profiles may hold diagnostic or credential-bearing
  // URLs. Do not serialize any of their connection details into the browser.
  const connection = !value.canSaveDraft || value.connection == null ? null : value.connection;
  if (connection && (connection.providerKey !== "CENTOVA_CAST" || connection.outputCodec !== "MP3" ||
      !safeListener(connection.streamUrl) || !text(connection.serverHost ?? "", 254) || !text(connection.centovaUsername ?? "", 80) ||
      !text(connection.sourceUsername ?? "", 120) || !portOrNull(connection.serverPort ?? null) || !portOrNull(connection.sourcePort ?? null) ||
      !numberOrNull(connection.bitrateKbps ?? null) || typeof connection.credentialConfigured !== "boolean")) invalid();
  const entitlementKeys = ["maxBitrateKbps", "listenerLimit", "storageLimitGb", "stationLimit", "streamLimit", "siteLimit", "displayLimit", "digitalSignageDisplayLimit"];
  return {
    organisation: { id: organisationId, name: value.organisation.name }, canSaveDraft: value.canSaveDraft,
    blockedReason: Object.hasOwn(messages, value.blockedReason || "") ? value.blockedReason : null,
    entitlements: Object.fromEntries(entitlementKeys.map(key => [key, value.entitlements[key] ?? null])),
    station: station ? { id: station.id, status: station.status } : null,
    connection: connection ? { providerKey: "CENTOVA_CAST", outputCodec: "MP3", streamUrl: connection.streamUrl || "",
      serverHost: connection.serverHost || "", serverPort: connection.serverPort ?? null, sourcePort: connection.sourcePort ?? null,
      centovaUsername: connection.centovaUsername || "", sourceUsername: connection.sourceUsername || "",
      bitrateKbps: connection.bitrateKbps ?? null, credentialConfigured: connection.credentialConfigured } : null,
    canStart: false, probeEnabled: false, outboundAutoDjEnabled: false, publicPlayerEnabled: false,
    stationWebsiteEnabled: false, listenerRequestsEnabled: false, audiencePolicy: "INTERNAL",
    requiresPlanLimitReview: value.requiresPlanLimitReview
  };
}

export function retailStreamConnectionForm(setup) {
  const connection = setup?.connection;
  return { streamUrl: connection?.streamUrl || "", serverHost: connection?.serverHost || "",
    serverPort: connection?.serverPort == null ? "" : String(connection.serverPort),
    sourcePort: connection?.sourcePort == null ? "" : String(connection.sourcePort),
    centovaUsername: connection?.centovaUsername || "", sourceUsername: connection?.sourceUsername || "",
    bitrateKbps: connection?.bitrateKbps == null ? "" : String(connection.bitrateKbps) };
}

export function retailStreamDraftRequest(form, sourcePassword, { maximumBitrateKbps, credentialConfigured = false } = {}) {
  if (!form || typeof sourcePassword !== "string" || sourcePassword.length > 1024 || /[\u0000-\u001f\u007f]/.test(sourcePassword))
    throw new Error("Enter a valid source password. Never use the Centova administrator password.");
  if (credentialConfigured && sourcePassword !== "") throw new Error("Changing a saved source password needs a separate administrator review.");
  if (!credentialConfigured && sourcePassword.length === 0) throw new Error("Enter the Centova live-source password for this new draft.");
  const string = (key, maximum, required = true) => {
    const value = form[key];
    if (!text(value, maximum) || required && !value.trim()) throw new Error("Complete the connection fields using the exact Centova details.");
    return value.trim();
  };
  const integer = (key, optional = false) => {
    const value = string(key, 5, !optional);
    if (!value && optional) return null;
    if (!/^[1-9][0-9]{0,4}$/.test(value) || !portOrNull(Number(value))) throw new Error("Ports must be whole numbers from 1 to 65535. Use the supplied live-source port; do not calculate it.");
    return Number(value);
  };
  const streamUrl = string("streamUrl", 2048), serverHost = string("serverHost", 254), centovaUsername = string("centovaUsername", 80);
  let endpoint;
  try { endpoint = new URL(streamUrl); } catch { throw new Error("Enter the HTTPS listener address supplied by your provider."); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new Error("The listener address must use HTTPS without credentials, query parameters or a fragment.");
  const bitrate = string("bitrateKbps", 3);
  if (!/^[1-9][0-9]{0,2}$/.test(bitrate) || !Number.isInteger(maximumBitrateKbps) || maximumBitrateKbps < 8 ||
      maximumBitrateKbps > 320 || Number(bitrate) < 8 || Number(bitrate) > maximumBitrateKbps)
    throw new Error("Choose a bitrate within the organisation’s current plan limit.");
  const request = { providerKey: "CENTOVA_CAST", outputCodec: "MP3", streamUrl, serverHost,
    serverPort: integer("serverPort", true), sourcePort: integer("sourcePort"), centovaUsername,
    sourceUsername: string("sourceUsername", 120, false), bitrateKbps: Number(bitrate),
    ...(sourcePassword ? { sourcePassword } : {}) };
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > RETAIL_STREAM_DRAFT_REQUEST_BYTES)
    throw new Error("The connection details exceed the 4 KB request limit. Review the supplied addresses and source password.");
  return request;
}

const messages = Object.freeze({
  RETAIL_STREAM_HOST_INVALID: "Check the source host. Enter a hostname only, not a URL, port or private address.",
  RETAIL_STREAM_LISTENER_INVALID: "Check the public HTTPS listener address. Do not include a password or query parameters.",
  RETAIL_STREAM_BITRATE_NOT_ALLOWED: "The bitrate exceeds the current plan. Reload to review its existing limit.",
  RETAIL_STREAM_TARGET_RESERVED: "This connection belongs to Test Radio and cannot be reused for Retail.",
  RETAIL_STREAM_SOURCE_ALREADY_ASSIGNED: "This provider destination is already assigned. No existing connection was changed.",
  RETAIL_STREAM_SHARED_STREAM_EXISTS: "This organisation already has a Retail stream. Reload and review its saved draft.",
  RETAIL_STREAM_PROFILE_NOT_EDITABLE: "This existing connection is protected. A running, leased or configured profile cannot be changed here.",
  RETAIL_STREAM_EXISTING_OUTPUTS_INVALID: "An existing provider assignment needs administrator review before a Retail draft can be saved.",
  RETAIL_STREAM_SETUP_CREDENTIAL_UPDATE_REQUIRES_REVIEW: "Changing a saved source password needs a separate administrator review.",
  RETAIL_STREAM_SETUP_TARGET_UPDATE_REQUIRES_REVIEW: "Changing a saved provider destination needs a separate administrator review.",
  RETAIL_STREAM_SETUP_INPUT_INVALID: "Complete only the connection fields shown here, then review the draft again.",
  RETAIL_STREAM_SETUP_ADMIN_REQUIRED: "Your current Super Admin permission could not be verified. Sign in again before continuing.",
  RETAIL_STREAM_SETUP_ORGANISATION_NOT_FOUND: "This existing organisation could not be found. Return to the organisations list.",
  RETAIL_STREAM_SETUP_SERVICE_INACTIVE: "The organisation needs an active Retail service before a draft can be saved.",
  RETAIL_STREAM_SETUP_RETAIL_NOT_INCLUDED: "Retail is not enabled for this organisation. Review its existing service; no plan was changed.",
  RETAIL_STREAM_SETUP_PLAN_LIMITS_REQUIRED: "The existing plan needs valid stream, listener, storage and bitrate limits. This screen does not change those limits.",
  RETAIL_STREAM_SETUP_STATION_LIMIT_REACHED: "This organisation has reached its existing station allowance. No station or plan limit was changed.",
  RETAIL_STREAM_SETUP_PROFILE_REVIEW_REQUIRED: "An existing station or streaming profile is protected and needs administrator review. Nothing was reset.",
  RETAIL_STREAM_SETUP_INVENTORY_REVIEW_REQUIRED: "Existing provider assignments need review before another connection can be saved.",
  RETAIL_STREAM_SETUP_SOURCE_ALREADY_ASSIGNED: "This provider destination is already assigned. No existing connection was changed.",
  RETAIL_STREAM_SETUP_SOURCE_CREDENTIAL_REQUIRED: "Enter the Centova live-source password for this first draft, not the administrator password.",
  RETAIL_STREAM_SETUP_SOURCE_CREDENTIAL_INVALID: "Use the exact source password, at most 1024 characters with no control characters.",
  RETAIL_STREAM_SETUP_CREDENTIAL_ENCRYPTION_FAILED: "The source password could not be stored securely. Nothing was saved; reload before trying again.",
  RETAIL_STREAM_SETUP_CONCURRENT_CHANGE: "The draft changed in another request. Reload saved status before continuing.",
  RETAIL_STREAM_SETUP_PERSISTENCE_UNAVAILABLE: "The draft save could not be confirmed. Reload saved status before retrying; no stream was started.",
  RETAIL_STREAM_SERVICE_INACTIVE: "The organisation needs an active Retail service before a draft can be saved.",
  RETAIL_STREAM_RETAIL_NOT_INCLUDED: "Retail is not enabled for this organisation. Review its existing service; no plan was changed."
});
export function retailStreamSetupNotice(code) {
  return messages[code] || "Retail draft setup needs administrator review. Reload the saved status and check the organisation’s existing Retail service, limits and provider assignment.";
}

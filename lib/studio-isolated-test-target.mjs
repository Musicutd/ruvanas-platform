import { isIP } from "node:net";
import { isPrivateNetworkAddress } from "./stream-source-health.mjs";

// These are the known production settings for Radio Test 105, not secrets.
// The caller must also provide its current production target: this fixed
// guard alone cannot detect a later production configuration change.
const KNOWN_LIVE_LISTENER = "https://plus-radio105network.radioca.st/stream";
const KNOWN_LIVE_SOURCE = "pollux.shoutca.st:8393";

function listener(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash ||
      url.hostname === "localhost" || url.hostname.endsWith(".local") || url.hostname.endsWith(".internal") ||
      (isIP(url.hostname) && isPrivateNetworkAddress(url.hostname))) {
    throw new Error("The isolated listener must be a public HTTPS URL without credentials or query parameters.");
  }
  return `${url.origin.toLowerCase()}${url.pathname.replace(/\/$/, "") || "/"}`;
}

function source(host, port) {
  const normalizedHost = String(host || "").trim().toLowerCase().replace(/\.$/, "");
  const normalizedPort = Number(port);
  if (!/^[a-z0-9.-]{1,253}$/.test(normalizedHost) || normalizedHost === "localhost" ||
      normalizedHost.endsWith(".local") || normalizedHost.endsWith(".internal") ||
      (isIP(normalizedHost) && isPrivateNetworkAddress(normalizedHost)) ||
      !Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
    throw new Error("The isolated live-source host and port are invalid.");
  }
  return `${normalizedHost}:${normalizedPort}`;
}

export function validateStudioIsolatedTestTarget({
  acknowledgement, testListenerUrl, testSourceHost, testSourcePort,
  productionListenerUrl, productionSourceHost, productionSourcePort
}) {
  if (acknowledgement !== "ISOLATED_TEST_STREAM") {
    throw new Error("Explicit isolated-test acknowledgement is required.");
  }
  // Both production comparators are mandatory. Omitting either would turn a
  // typo or changed production endpoint into a plausible-looking test target.
  const testListener = listener(testListenerUrl);
  const productionListener = listener(productionListenerUrl);
  const testSource = source(testSourceHost, testSourcePort);
  const productionSource = source(productionSourceHost, productionSourcePort);
  if (testListener === productionListener || testListener === KNOWN_LIVE_LISTENER ||
      testSource === productionSource || testSource === KNOWN_LIVE_SOURCE) {
    throw new Error("The test target matches a production listener or live-source endpoint.");
  }
  return { isolated: true, listener: testListener, source: testSource, audioVerified: false };
}

const READ = new Set(["GET", "HEAD"]);
const DEVICE_ROUTES = new Map([
  ["/api/player/state", new Set(["GET"])],
  ["/api/player/manifest", new Set(["GET"])],
  ["/api/player/heartbeat", new Set(["POST", "DELETE"])],
  ["/api/player/stream-evidence", new Set(["POST"])]
]);

// The code-entry shell and compiled client assets contain no account data.
// Enrolment itself validates an unexpired, single-use Retail-only code. It
// remains subject to the ordinary same-origin and request-size checks.
export function retailTestPlayerBootstrapRequest(pathname, method) {
  if (pathname === "/player" && READ.has(method)) return true;
  if (pathname === "/api/player/enrol" && method === "POST") return true;
  return READ.has(method) && typeof pathname === "string" &&
    /^\/_next\/static\/[A-Za-z0-9_./-]+\.(?:js|css|woff2?|ttf|otf|png|jpe?g|svg|webp|avif)$/.test(pathname) && !pathname.includes("..");
}

export function retailTestPlayerDeviceRequest(pathname, method) {
  return DEVICE_ROUTES.get(pathname)?.has(method) === true;
}

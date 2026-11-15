import { readPrivatePreviewBody, PREVIEW_RESPONSE_HEADERS } from "./private-preview-request.mjs";
import { safeRetailStreamSetupView } from "./retail-stream-setup-ui.mjs";

export const RETAIL_STREAM_SETUP_FIELDS = Object.freeze([
  "providerKey", "outputCodec", "streamUrl", "serverHost", "serverPort", "sourcePort",
  "centovaUsername", "sourceUsername", "bitrateKbps", "sourcePassword"
]);
const idValid = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
const respond = (body, status = 200) => Response.json(body, { status, headers: {
  ...PREVIEW_RESPONSE_HEADERS, "x-content-type-options": "nosniff"
} });
const unavailable = () => respond({ error: "Retail connection setup is temporarily unavailable. Nothing has been started.", code: "RETAIL_SETUP_UNAVAILABLE" }, 503);

// Only the configured application origin is trusted, never a forwarded Host
// header. Local HTTP origins are an explicit development-only dependency.
export function retailSetupOrigin(value, { allowLocalHttp = false } = {}) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (url.protocol !== "https:" && !(allowLocalHttp && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}

/** No provider calls live here. Authentication is checked before any service
 * query; the service must recheck role, ownership and entitlements in its
 * transaction. Dependencies make request behaviour testable without live data.
 */
export function createRetailStreamSetupHandlers({ getAdmin, loadSetup, saveSetup, correctSourceHost, canonicalOrigin, publicFailure = () => null }) {
  function failure(error) {
    const known = publicFailure(error);
    return known && [400, 403, 404, 409, 503].includes(known.status)
      ? respond({ error: known.message, code: known.code }, known.status)
      : unavailable();
  }
  async function actor(context) {
    const access = await getAdmin();
    if (!access?.ok || access.user?.role !== "SUPER_ADMIN" || !idValid(access.user?.id)) {
      return { response: respond({ error: "Sign in as a Ruvanas Super Admin to configure Retail streaming.", code: "RETAIL_SETUP_ADMIN_REQUIRED" }, access?.status === 401 ? 401 : 403) };
    }
    const { organisationId } = await context.params;
    if (!idValid(organisationId)) return { response: respond({ error: "A valid subscriber organisation is required.", code: "RETAIL_SETUP_ORGANISATION_REQUIRED" }, 400) };
    return { actorUserId: access.user.id, organisationId };
  }
  return {
    async GET(request, context) {
      try {
        const check = await actor(context); if (check.response) return check.response;
        return respond({ setup: safeRetailStreamSetupView(await loadSetup(check), check.organisationId) });
      } catch (error) { return failure(error); }
    },
    async PATCH(request, context) {
      const origin = typeof canonicalOrigin === "function" ? canonicalOrigin() : canonicalOrigin;
      if (!origin || request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") {
        return respond({ error: "Confirm the correction from the signed-in Ruvanas website.", code: "RETAIL_SETUP_ORIGIN_REQUIRED" }, 403);
      }
      try {
        const check = await actor(context); if (check.response) return check.response;
        let input;
        try { input = await readPrivatePreviewBody(request, ["expectedCurrentHost", "confirmation"]); }
        catch { return respond({ error: "Send only the confirmed hostname correction.", code: "RETAIL_SETUP_INVALID_REQUEST" }, 400); }
        if (typeof correctSourceHost !== "function") return unavailable();
        const result = await correctSourceHost({ ...check, input });
        if (result?.saved !== true) return unavailable();
        return respond({ saved: true, setup: safeRetailStreamSetupView(result.setup, check.organisationId) });
      } catch (error) { return failure(error); }
    },
    async POST(request, context) {
      const origin = typeof canonicalOrigin === "function" ? canonicalOrigin() : canonicalOrigin;
      if (!origin || request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") {
        return respond({ error: "Save the connection from the signed-in Ruvanas website.", code: "RETAIL_SETUP_ORIGIN_REQUIRED" }, 403);
      }
      try {
        const check = await actor(context); if (check.response) return check.response;
        let input;
        try { input = await readPrivatePreviewBody(request, RETAIL_STREAM_SETUP_FIELDS); }
        catch { return respond({ error: "Send only the Retail connection fields, within the request size limit.", code: "RETAIL_SETUP_INVALID_REQUEST" }, 400); }
        const result = await saveSetup({ ...check, input });
        if (result?.saved !== true) return unavailable();
        return respond({ saved: true, setup: safeRetailStreamSetupView(result.setup, check.organisationId) });
      } catch (error) { return failure(error); }
    }
  };
}

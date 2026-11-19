import { PREVIEW_RESPONSE_HEADERS, readPrivatePreviewBody } from "./private-preview-request.mjs";
import { RETAIL_PILOT_ACCESS, RetailPilotAccessError } from "./retail-stream-pilot-access.mjs";

const respond = (body, status = 200) => Response.json(body, { status, headers: { ...PREVIEW_RESPONSE_HEADERS, "x-content-type-options": "nosniff" } });
const notices = { OWNER_REQUIRED: "Sign in as the platform owner to review Test Retail’s pilot access.",
  TARGET_UNAVAILABLE: "This approval is available only for the saved Test Retail pilot connection.",
  TESTER_UNAVAILABLE: "The Retail tester’s current access needs review. No permissions were changed.",
  STOP_REQUIRED: "Confirm Test Retail is stopped before changing its pilot access.",
  CONFIRMATION_REQUIRED: "Confirm this Test Retail-only access change before saving.",
  SIGNING_UNAVAILABLE: "Pilot access cannot be securely approved right now.",
  CATALOGUE_REVIEW_REQUIRED: "The existing Retail catalogue needs review before showing an eligible count." };
function failure(error) {
  if (error instanceof RetailPilotAccessError) return respond({ code: error.code,
    error: notices[error.code.replace("RETAIL_PILOT_ACCESS_", "")] || "Test Retail pilot access could not be verified." }, error.status);
  return respond({ code: "RETAIL_PILOT_ACCESS_UNAVAILABLE", error: "Test Retail pilot access is unavailable. Refresh before another change." }, 503);
}
export function safeRetailPilotAccessView(value) {
  if (!value || !["eligible", "approved", "canApprove", "canRevoke"].every(name => typeof value[name] === "boolean") ||
    value.territory !== "MT" || value.catalogueLevel !== "FOCUSED" ||
    JSON.stringify(value.sourceScopes) !== JSON.stringify(RETAIL_PILOT_ACCESS.sourceScopes) ||
    !Number.isSafeInteger(value.eligibleTrackCount) || value.eligibleTrackCount < 0 || value.eligibleTrackCount >= 5000 ||
    value.expiresAt !== null && (!Number.isFinite(Date.parse(value.expiresAt)) || typeof value.expiresAt !== "string") ||
    value.blocker !== null && !/^RETAIL_PILOT_ACCESS_[A-Z_]{1,80}$/.test(value.blocker || "") ||
    value.canApprove && (!value.eligible || value.approved) || value.approved && (!value.eligible || !value.expiresAt)) throw new Error("INVALID_ACCESS_VIEW");
  return Object.fromEntries(["eligible", "approved", "canApprove", "canRevoke", "territory", "catalogueLevel", "sourceScopes",
    "eligibleTrackCount", "expiresAt", "blocker"].map(name => [name, Array.isArray(value[name]) ? [...value[name]] : value[name]]));
}
export function createRetailPilotAccessHandlers({ getAdmin, proposal, change, canonicalOrigin }) {
  async function scope(context) {
    const access = await getAdmin();
    if (!access?.ok || access.user?.role !== "SUPER_ADMIN" || !/^[A-Za-z0-9_-]{1,191}$/.test(access.user?.id || ""))
      throw new RetailPilotAccessError("OWNER_REQUIRED", access?.status === 401 ? 401 : 403);
    const { organisationId } = await context.params;
    if (organisationId !== RETAIL_PILOT_ACCESS.organisationId) throw new RetailPilotAccessError("TARGET_UNAVAILABLE", 404);
    return { actorUserId: access.user.id, organisationId };
  }
  return {
    async GET(_request, context) {
      try { return respond({ access: safeRetailPilotAccessView(await proposal(await scope(context))) }); }
      catch (error) { return failure(error); }
    },
    async POST(request, context) {
      const origin = typeof canonicalOrigin === "function" ? canonicalOrigin() : canonicalOrigin;
      if (!origin || request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site")
        return respond({ code: "RETAIL_PILOT_ACCESS_ORIGIN_REQUIRED", error: "Use the signed-in Ruvanas website to review Test Retail access." }, 403);
      try {
        const actor = await scope(context); let body;
        try { body = await readPrivatePreviewBody(request, ["action", "confirmed"]);
          if (!["approve", "revoke"].includes(body.action) || body.confirmed !== true) throw new Error("INVALID"); }
        catch { throw new RetailPilotAccessError("CONFIRMATION_REQUIRED", 400); }
        const result = await change({ ...actor, ...body });
        if (result?.accepted !== true || result.action !== body.action) throw new Error("UNCONFIRMED");
        return respond({ accepted: true, action: body.action, access: safeRetailPilotAccessView(result.access) });
      } catch (error) { return failure(error); }
    }
  };
}

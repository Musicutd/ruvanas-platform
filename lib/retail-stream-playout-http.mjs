import { readPrivatePreviewBody, PREVIEW_RESPONSE_HEADERS } from "./private-preview-request.mjs";
import { safeRetailPlayoutView, retailMusicRequest, retailPlayoutNotice } from "./retail-stream-playout-ui.mjs";

const fields = ["action", "territory", "genreCodes", "monthlyBudgetUsd", "publicExposureAccepted"];
const actions = { prepare: ["action", "territory", "genreCodes"], start: ["action", "monthlyBudgetUsd", "publicExposureAccepted"], stop: ["action"] };
const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
const respond = (body, status = 200) => Response.json(body, { status, headers: { ...PREVIEW_RESPONSE_HEADERS, "x-content-type-options": "nosniff" } });
const unavailable = () => respond({ code: "RETAIL_PLAYOUT_UNAVAILABLE", error: "Retail streaming status is unavailable. Refresh before another change; no result is assumed." }, 503);

export function createRetailPlayoutHandlers({ getAdmin, loadReadiness, prepare, start, stop, canonicalOrigin, publicFailure = () => null }) {
  async function actor(context) {
    const access = await getAdmin();
    if (!access?.ok || access.user?.role !== "SUPER_ADMIN" || !validId(access.user?.id)) return {
      response: respond({ code: "RETAIL_PLAYOUT_ADMIN_REQUIRED", error: retailPlayoutNotice("RETAIL_PLAYOUT_ADMIN_REQUIRED") }, access?.status === 401 ? 401 : 403)
    };
    const { organisationId } = await context.params;
    if (!validId(organisationId)) return { response: respond({ code: "RETAIL_PLAYOUT_INPUT_INVALID", error: "A valid Retail subscriber workspace is required." }, 400) };
    return { actorUserId: access.user.id, organisationId };
  }
  function failure(error) {
    const known = publicFailure(error);
    if (!known || ![400, 403, 404, 409, 503].includes(known.status) || !/^RETAIL_PLAYOUT_[A-Z_]{1,80}$/.test(known.code || "")) return unavailable();
    return respond({ code: known.code, error: retailPlayoutNotice(known.code) }, known.status);
  }
  async function view(scope) { return safeRetailPlayoutView(await loadReadiness(scope), scope.organisationId); }
  return {
    async GET(_request, context) {
      try { const scope = await actor(context); return scope.response || respond({ readiness: await view(scope) }); }
      catch (error) { return failure(error); }
    },
    async POST(request, context) {
      const origin = typeof canonicalOrigin === "function" ? canonicalOrigin() : canonicalOrigin;
      if (!origin || request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") return respond({
        code: "RETAIL_PLAYOUT_ORIGIN_REQUIRED", error: "Use the signed-in Ruvanas website to manage this Retail stream."
      }, 403);
      try {
        const scope = await actor(context); if (scope.response) return scope.response;
        let body;
        try {
          body = await readPrivatePreviewBody(request, fields);
          if (!Object.hasOwn(actions, body.action) || Object.keys(body).some(key => !actions[body.action].includes(key))) throw new Error("INVALID_BODY");
          if (body.action === "prepare") body = retailMusicRequest(body);
          if (body.action === "start" && (body.publicExposureAccepted !== true || typeof body.monthlyBudgetUsd !== "number" ||
            !Number.isFinite(body.monthlyBudgetUsd) || body.monthlyBudgetUsd <= 0 || body.monthlyBudgetUsd > 100000)) throw new Error("INVALID_BODY");
        } catch { return respond({ code: "RETAIL_PLAYOUT_INPUT_INVALID", error: retailPlayoutNotice("RETAIL_PLAYOUT_INPUT_INVALID") }, 400); }
        const { action, ...input } = body;
        // Never accept a station, worker, capacity assignment or cost grant from
        // the client. Each service derives and rechecks its tenant-scoped state.
        const result = await ({ prepare, start, stop })[action]({ ...scope, ...input });
        if (action === "prepare" && result?.prepared !== true || action === "start" && result?.enabled !== true ||
          action === "stop" && result?.enabled !== false) return unavailable();
        // Revocation may succeed while a broken plan/source prevents a fresh
        // readiness read. Preserve confirmation of the STOP request only; do
        // not imply that the source has already disconnected.
        if (action === "stop") {
          try { return respond({ action, accepted: true, readiness: await view(scope) }); }
          catch { return respond({ action, accepted: true, status: "STOP_REQUESTED", readiness: null }); }
        }
        return respond({ action, accepted: true, readiness: await view(scope) });
      } catch (error) { return failure(error); }
    }
  };
}

import { readPrivatePreviewBody, PREVIEW_RESPONSE_HEADERS } from "./private-preview-request.mjs";
import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG } from "./retail-subscriber-access.mjs";

const fields = ["action", "draftId", "reviewHash", "baseApprovalId", "requestId", "acknowledged"];
const respond = (body, status = 200) => Response.json(body, { status, headers: { ...PREVIEW_RESPONSE_HEADERS, "x-content-type-options": "nosniff" } });
export function createRetailCommercialOwnerHandlers({ getAdmin, review, approve, canonicalOrigin }) {
  async function actor(request, context) {
    const access = await getAdmin();
    if (!access?.ok || access.user?.role !== "SUPER_ADMIN" || typeof access.user.id !== "string") return { response: respond({
      error: "Sign in with the Super Admin owner account to review commercials." }, access?.status === 401 ? 401 : 403) };
    const { organisationId } = await context.params;
    if (organisationId !== ORG) return { response: respond({ error: "This review is available only for Test Retail." }, 404) };
    if ([...new URL(request.url).searchParams].length) return { response: respond({ error: "Use the current Retail review page." }, 400) };
    return { actorUserId: access.user.id, organisationId };
  }
  const failure = error => respond({ error: "The commercial approval could not be confirmed. Refresh, review the current draft and its approved audio, then try again.",
    code: /^RETAIL_COMMERCIAL_[A-Z_]{1,80}$/.test(error?.code || "") ? error.code : "RETAIL_COMMERCIAL_REVIEW_UNAVAILABLE" }, 409);
  return {
    async GET(request, context) {
      try { const scope = await actor(request, context); return scope.response || respond(await review(scope)); }
      catch (error) { return failure(error); }
    },
    async POST(request, context) {
      const origin = typeof canonicalOrigin === "function" ? canonicalOrigin() : canonicalOrigin;
      if (!origin || request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") return respond({
        error: "Use the signed-in Ruvanas website to approve commercials." }, 403);
      try {
        const scope = await actor(request, context); if (scope.response) return scope.response;
        let body;
        try { body = await readPrivatePreviewBody(request, fields);
          if (body.action !== "approve" || body.acknowledged !== true || fields.some(key => !Object.hasOwn(body, key))) throw new Error("INVALID_BODY");
        } catch { return respond({ error: "Review the current draft and acknowledge its effect before approving." }, 400); }
        const { action: _action, acknowledged: _acknowledged, ...input } = body;
        return respond({ ...await approve({ ...scope, ...input }), accepted: true });
      } catch (error) { return failure(error); }
    }
  };
}

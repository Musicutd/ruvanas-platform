import { readPrivatePreviewBody, PREVIEW_RESPONSE_HEADERS } from "./private-preview-request.mjs";
import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG } from "./retail-subscriber-access.mjs";
import { retailOwnerScheduleError } from "./retail-owner-schedule-service.mjs";

const fields = { approve: ["action", "versionId", "reviewHash", "requestId", "overridesAcknowledged"],
  "prepare-test": ["action", "sourceId", "startsAt", "durationMinutes", "requestId", "baseVersionId"] };
const respond = (body, status = 200) => Response.json(body, { status, headers: { ...PREVIEW_RESPONSE_HEADERS, "x-content-type-options": "nosniff" } });
export function createRetailOwnerScheduleHandlers({ getAdmin, dashboard, approve, prepareTest, canonicalOrigin }) {
  async function actor(request, context) {
    const access = await getAdmin();
    if (!access?.ok || access.user?.role !== "SUPER_ADMIN" || typeof access.user?.id !== "string") return { response: respond({
      code: "RETAIL_SCHEDULE_OWNER_REQUIRED", error: "Sign in with the current Super Admin owner account." }, access?.status === 401 ? 401 : 403) };
    const { organisationId } = await context.params;
    if (organisationId !== ORG) return { response: respond({ code: "RETAIL_SCHEDULE_SCOPE_INVALID", error: "This review is available only for Test Retail." }, 404) };
    if ([...new URL(request.url).searchParams].length) return { response: respond({ code: "RETAIL_SCHEDULE_INPUT_INVALID", error: "Use the current Retail review controls." }, 400) };
    return { actorUserId: access.user.id, organisationId };
  }
  const failure = error => { const { status, ...body } = retailOwnerScheduleError(error); return respond(body, status); };
  return {
    async GET(request, context) {
      try { const scope = await actor(request, context); return scope.response || respond(await dashboard(scope)); }
      catch (error) { return failure(error); }
    },
    async POST(request, context) {
      const origin = typeof canonicalOrigin === "function" ? canonicalOrigin() : canonicalOrigin;
      if (!origin || request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") return respond({
        code: "RETAIL_SCHEDULE_ORIGIN_REQUIRED", error: "Use the signed-in Ruvanas site to review Test Retail." }, 403);
      try {
        const scope = await actor(request, context); if (scope.response) return scope.response;
        let body;
        try { body = await readPrivatePreviewBody(request, [...new Set(Object.values(fields).flat())]);
          if (!Object.hasOwn(fields, body.action) || Object.keys(body).some(key => !fields[body.action].includes(key))) throw new Error("INVALID_BODY");
        } catch { return respond({ code: "RETAIL_SCHEDULE_INPUT_INVALID", error: "Send only the current bounded review command." }, 400); }
        const { action, ...input } = body;
        const result = await (action === "approve" ? approve : prepareTest)({ ...scope, ...input });
        return respond({ ...result, action, accepted: true });
      } catch (error) { return failure(error); }
    }
  };
}

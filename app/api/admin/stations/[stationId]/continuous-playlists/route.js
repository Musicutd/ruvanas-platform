import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/auth";
import { catalogueTestOwnerSessionValid } from "@/lib/catalogue-test-service.mjs";
import { TEST_RADIO_CONTINUOUS } from "@/lib/test-radio-continuous-policy.mjs";
import { readPrivatePreviewBody } from "@/lib/private-preview-request.mjs";
import { testRadioPlannerLibrary, previewTestRadioRecipe, createTestRadioRecipe, testRadioLibraryMessage } from "@/lib/test-radio-planner-library.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const respond = (body, status = 200) => NextResponse.json(body, { status, headers: {
  "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "same-origin" } });
async function access(params) {
  const { stationId } = await params;
  if (stationId !== TEST_RADIO_CONTINUOUS.stationId) return { error: respond({ error: "Test Radio only." }, 404) };
  const actorSession = await getCurrentSession();
  if (!catalogueTestOwnerSessionValid(actorSession, actorSession?.userId, new Date())) return { error: respond({ error: "Sign in with the current Super Admin owner session." }, 403) };
  return { actorSession };
}
function failure(error) {
  const code = /^(LIBRARY|CONTINUOUS)_[A-Z_]+$/.test(error?.code || "") ? error.code : "LIBRARY_UNAVAILABLE";
  return respond({ error: testRadioLibraryMessage(code), code }, code === "LIBRARY_UNAVAILABLE" ? 503 : 409);
}
export async function GET(_request, { params }) {
  const check = await access(params); if (check.error) return check.error;
  try { return respond(await testRadioPlannerLibrary(prisma, { actorSession: check.actorSession })); }
  catch (error) { return failure(error); }
}
export async function POST(request, { params }) {
  if (request.headers.get("origin") !== TEST_RADIO_CONTINUOUS.origin) return respond({ error: "Use the signed-in canonical Ruvanas site." }, 403);
  const check = await access(params); if (check.error) return check.error;
  let input;
  try {
    input = await readPrivatePreviewBody(request, ["action", "name", "buildMode", "genreCodes", "durationMinutes", "seed", "requestId"]);
    if (!["preview", "save"].includes(input.action) || input.action === "preview" && Object.hasOwn(input, "requestId") || input.action === "save" && Object.hasOwn(input, "seed")) throw new Error("INVALID_BODY");
  } catch { return respond({ error: "Send a valid bounded playlist-preview or save-as-new command." }, 400); }
  try {
    const options = { actorSession: check.actorSession, input };
    return respond(await (input.action === "preview" ? previewTestRadioRecipe(prisma, options) : createTestRadioRecipe(prisma, options)));
  } catch (error) { return failure(error); }
}

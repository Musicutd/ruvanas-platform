import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/auth";
import { readPrivatePreviewBody } from "@/lib/private-preview-request.mjs";
import { catalogueTestDashboard, prepareCatalogueTest, armCatalogueTest, stopCatalogueTest,
  catalogueTestOwnerSessionValid } from "@/lib/catalogue-test-service.mjs";
import { TEST_RADIO_CATALOGUE_TEST, CATALOGUE_TEST_REASON_LABELS } from "@/lib/online-radio-catalogue-test.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const respond = (body, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
const labels = { ...CATALOGUE_TEST_REASON_LABELS,
  TEST_SOURCE_NOT_READY: "Save the exact Test Radio Centova connection and its existing source password first. Keep ordinary AutoDJ output off.",
  TEST_START_NOT_ENABLED: "Starting audio is disabled for this release. The streaming worker and a separate live-test confirmation are still required.",
  TEST_WORKER_NOT_READY: "No dedicated test worker is ready for Test Radio. No audio was started.",
  TEST_ALREADY_ACTIVE: "An existing test must finish or stop before another starts.",
  TEST_STOP_UNCONFIRMED: "A previous test's stop could not be confirmed. The stream needs manual review before another test can be prepared or started.",
  TEST_OWNER_SESSION_REQUIRED: "Sign in with your current Super Admin owner session.",
  TEST_PUBLIC_EXPOSURE_CONFIRMATION_REQUIRED: "Confirm that Centova's direct stream can be reached by anyone who has its address.",
  TEST_TRACK_APPROVAL_CHANGED: "Track approval or file details changed. Prepare a fresh test.",
  TEST_SOURCE_CHANGED: "The saved stream connection changed. Prepare a fresh test.",
  TEST_AUTHORIZATION_INACTIVE: "This test permission has expired or been stopped. Prepare a fresh test.",
  TEST_NOT_ACTIVE: "There is no active test to stop.",
  TEST_PREPARATION_EXPIRED: "Prepare a fresh test so its full stop deadline fits the permission window."
};
async function access(params) {
  const { stationId } = await params;
  if (stationId !== TEST_RADIO_CATALOGUE_TEST.stationId) return { error: respond({ error: "Test Radio only." }, 404) };
  const actorSession = await getCurrentSession();
  if (!catalogueTestOwnerSessionValid(actorSession, actorSession?.userId, new Date())) return { error: respond({ error: labels.TEST_OWNER_SESSION_REQUIRED }, 403) };
  return { actorSession };
}
function failure(error) {
  const code = typeof error?.code === "string" && Object.hasOwn(labels, error.code) ? error.code : "TEST_UNAVAILABLE";
  // Never return driver, transport, credential or raw exception messages.
  return respond({ error: labels[code] || "The request could not be confirmed. Check Test Radio before retrying.", code }, code === "TEST_UNAVAILABLE" ? 503 : 409);
}
export async function GET(_request, { params }) {
  const check = await access(params);
  if (check.error) return check.error;
  try { return respond(await catalogueTestDashboard(prisma, { actorSession: check.actorSession,
    startEnabled: process.env.RUVANAS_CATALOGUE_TEST_START_ENABLED === "true" })); }
  catch (error) { return failure(error); }
}
export async function POST(request, { params }) {
  if (request.headers.get("origin") !== TEST_RADIO_CATALOGUE_TEST.origin) return respond({ error: "Use the signed-in canonical Ruvanas site." }, 403);
  const check = await access(params);
  if (check.error) return check.error;
  let input;
  try {
    input = await readPrivatePreviewBody(request, ["action", "sessionId", "publicExposureAccepted"]);
    if (!input || typeof input !== "object" || Array.isArray(input) || !["prepare", "arm", "stop"].includes(input.action) ||
        Object.keys(input).some(key => !["action", "sessionId", "publicExposureAccepted"].includes(key))) throw new Error();
    if (input.action !== "prepare" && !/^c[a-z0-9]{10,40}$/i.test(input.sessionId || "")) throw new Error();
  } catch { return respond({ error: "Send a valid test command." }, 400); }
  try {
    const options = { actorSession: check.actorSession, sessionId: input.sessionId };
    if (input.action === "prepare") return respond({ session: await prepareCatalogueTest(prisma, options) });
    if (input.action === "stop") return respond({ session: await stopCatalogueTest(prisma, options) });
    return respond({ session: await armCatalogueTest(prisma, { ...options, publicExposureAccepted: input.publicExposureAccepted,
      startEnabled: process.env.RUVANAS_CATALOGUE_TEST_START_ENABLED === "true" }) });
  } catch (error) { return failure(error); }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/auth";
import { readPrivatePreviewBody } from "@/lib/private-preview-request.mjs";
import { catalogueTestOwnerSessionValid } from "@/lib/catalogue-test-service.mjs";
import { TEST_RADIO_CONTINUOUS } from "@/lib/test-radio-continuous-policy.mjs";
import { continuousRadioDashboard, startContinuousRadio, stopContinuousRadio } from "@/lib/test-radio-continuous-service.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const respond = (body, status = 200) => NextResponse.json(body, { status, headers: {
  "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "same-origin" } });
const labels = {
  CONTINUOUS_START_DISABLED: "Continuous AutoDJ is not enabled on this release. No music was started.",
  CONTINUOUS_APPROVAL_REQUIRED: "Confirm the public stream address and the US$15 monthly limit.",
  CONTINUOUS_SOURCE_NOT_READY: "Save Test Radio's approved Centova connection first. No other station can be used.",
  CONTINUOUS_SOURCE_CHANGED: "Test Radio's connection changed. Stop and review it before starting again.",
  CONTINUOUS_SERVICE_INACTIVE: "Test Radio's current service permission is not active. No music was started.",
  CONTINUOUS_NO_APPROVED_MUSIC: "At least two existing recordings must pass Test Radio's current music-rights checks.",
  CONTINUOUS_CATALOGUE_TOO_LARGE: "The catalogue needs review before continuous playback can start.",
  CONTINUOUS_WORKER_BUSY: "Wait for the previous Test Radio source to stop before starting again.",
  CONTINUOUS_TEST_CONFLICT: "A timed test or an unconfirmed stop must be resolved before continuous playback.",
  CONTINUOUS_SCOPE_CHANGED: "Test Radio's isolated setup changed and needs review.",
  CONTINUOUS_BUDGET_EXHAUSTED: "Test Radio's monthly streaming allowance is exhausted. Ask for a budget review before continuing.",
  CONTINUOUS_SIGNING_UNAVAILABLE: "The continuous playback control cannot be verified. No music was started.",
};
async function access(params) {
  const { stationId } = await params;
  if (stationId !== TEST_RADIO_CONTINUOUS.stationId) return { error: respond({ error: "Test Radio only." }, 404) };
  const actorSession = await getCurrentSession();
  if (!catalogueTestOwnerSessionValid(actorSession, actorSession?.userId, new Date())) return { error: respond({ error: "Sign in with your current Super Admin owner session." }, 403) };
  return { actorSession };
}
function failure(error) {
  const code = typeof error?.code === "string" && Object.hasOwn(labels, error.code) ? error.code : "CONTINUOUS_UNAVAILABLE";
  return respond({ error: labels[code] || "The request could not be confirmed. Check Test Radio before retrying.", code }, code === "CONTINUOUS_UNAVAILABLE" ? 503 : 409);
}
export async function GET(_request, { params }) {
  const check = await access(params);
  if (check.error) return check.error;
  try { return respond(await continuousRadioDashboard(prisma, { actorSession: check.actorSession })); }
  catch (error) { return failure(error); }
}
export async function POST(request, { params }) {
  if (request.headers.get("origin") !== TEST_RADIO_CONTINUOUS.origin) return respond({ error: "Use the signed-in canonical Ruvanas site." }, 403);
  const check = await access(params);
  if (check.error) return check.error;
  let input;
  try {
    input = await readPrivatePreviewBody(request, ["action", "publicExposureAccepted", "monthlyBudgetUsd"]);
    if (!["start", "stop"].includes(input.action) || input.action === "stop" && Object.keys(input).length !== 1 ||
      input.action === "start" && (input.publicExposureAccepted !== true || input.monthlyBudgetUsd !== 15)) throw new Error();
  } catch { return respond({ error: "Send a valid continuous AutoDJ command." }, 400); }
  try {
    if (input.action === "stop") await stopContinuousRadio(prisma, { actorSession: check.actorSession });
    else await startContinuousRadio(prisma, { actorSession: check.actorSession, publicExposureAccepted: input.publicExposureAccepted, monthlyBudgetUsd: input.monthlyBudgetUsd });
    return respond(await continuousRadioDashboard(prisma, { actorSession: check.actorSession }));
  } catch (error) { return failure(error); }
}

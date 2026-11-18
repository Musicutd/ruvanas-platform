import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/auth";
import { catalogueTestOwnerSessionValid } from "@/lib/catalogue-test-service.mjs";
import { TEST_RADIO_CONTINUOUS } from "@/lib/test-radio-continuous-policy.mjs";
import { continuousScheduleDashboard, saveContinuousScheduleDraft, approveContinuousSchedule, disableContinuousSchedule, scheduleMessage } from "@/lib/test-radio-continuous-schedule-service.mjs";

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
  const code = /^(SCHEDULE|CONTINUOUS)_[A-Z_]+$/.test(error?.code || "") ? error.code : "SCHEDULE_UNAVAILABLE";
  return respond({ error: scheduleMessage(code), code }, code === "SCHEDULE_UNAVAILABLE" ? 503 : 409);
}
// A full 200-row week needs more than the four-KiB preview-command body limit.
// Stream-bound the body before parsing rather than trusting Content-Length.
async function readCommand(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) throw new Error("INVALID_BODY");
  const size = request.headers.get("content-length"), limit = 128 * 1024;
  if (size !== null && (!/^\d+$/.test(size) || Number(size) > limit)) throw new Error("INVALID_BODY");
  const reader = request.body?.getReader?.();
  if (!reader) throw new Error("INVALID_BODY");
  let bytes = 0; const chunks = [];
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) { void reader.cancel().catch(() => {}); throw new Error("INVALID_BODY"); }
    chunks.push(value);
  }
  const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  const allowed = { save: ["action", "channelId", "name", "timezone", "items"],
    approve: ["action", "channelId", "versionId", "reviewHash", "overridesAcknowledged"], disable: ["action"] };
  if (!body || Array.isArray(body) || !allowed[body.action] || Object.keys(body).some(key => !allowed[body.action].includes(key))) throw new Error("INVALID_BODY");
  return body;
}
export async function GET(request, { params }) {
  const check = await access(params); if (check.error) return check.error;
  const channelId = new URL(request.url).searchParams.get("channelId") || undefined;
  try { return respond(await continuousScheduleDashboard(prisma, { actorSession: check.actorSession, channelId })); }
  catch (error) { return failure(error); }
}
export async function POST(request, { params }) {
  if (request.headers.get("origin") !== TEST_RADIO_CONTINUOUS.origin) return respond({ error: "Use the signed-in canonical Ruvanas site." }, 403);
  const check = await access(params); if (check.error) return check.error;
  let input;
  try { input = await readCommand(request); } catch { return respond({ error: "Send a valid bounded weekly-planner command." }, 400); }
  try {
    const options = { actorSession: check.actorSession };
    if (input.action === "save") return respond(await saveContinuousScheduleDraft(prisma, { ...options, input }));
    if (input.action === "approve") return respond(await approveContinuousSchedule(prisma, { ...options, ...input }));
    await disableContinuousSchedule(prisma, options);
    try { return respond(await continuousScheduleDashboard(prisma, options)); }
    catch { return respond({ stationId: TEST_RADIO_CONTINUOUS.stationId, channels: [], sources: [], schedule: null, draft: null, approved: null,
      canEdit: false, warnings: ["Scheduled programmes are disabled. Continuous random AutoDJ was not stopped. Refresh to reload the planner."] }); }
  } catch (error) { return failure(error); }
}

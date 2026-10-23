import { TEST_RADIO_CONTINUOUS as P } from "./test-radio-continuous-policy.mjs";
import { subscriberError } from "./test-radio-subscriber-service.mjs";

export function subscriberQuery(request, fields) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !fields.includes(key) || params.getAll(key).length !== 1)) throw subscriberError("SUBSCRIBER_QUERY_INVALID");
  const query = Object.fromEntries(params);
  if (query.channelId !== undefined && !/^[a-zA-Z0-9_-]{1,191}$/.test(query.channelId)) throw subscriberError("SUBSCRIBER_QUERY_INVALID");
  return query;
}
export async function subscriberCommand(request, kind) {
  if (request.headers.get("origin") !== P.origin) throw subscriberError("SUBSCRIBER_ORIGIN_INVALID");
  const maximum = kind === "schedule" ? 128 * 1024 : 4096;
  const size = request.headers.get("content-length");
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "") ||
    (size !== null && (!/^\d+$/.test(size) || Number(size) > maximum))) throw subscriberError("SUBSCRIBER_BODY_INVALID");
  const reader = request.body?.getReader();
  if (!reader) throw subscriberError("SUBSCRIBER_BODY_INVALID");
  const chunks = []; let bytes = 0;
  while (true) {
    const result = await reader.read(); if (result.done) break;
    bytes += result.value.byteLength;
    if (bytes > maximum) { void reader.cancel().catch(() => {}); throw subscriberError("SUBSCRIBER_BODY_INVALID"); }
    chunks.push(result.value);
  }
  let input;
  try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw subscriberError("SUBSCRIBER_BODY_INVALID"); }
  const fields = kind === "schedule" && input?.action === "save" ? ["action", "channelId", "name", "timezone", "items", "requestId", "baseVersionId"] :
    kind === "library" && input?.action === "preview" ? ["action", "name", "buildMode", "genreCodes", "durationMinutes", "seed"] :
    kind === "library" && input?.action === "save" ? ["action", "name", "buildMode", "genreCodes", "durationMinutes", "requestId"] : null;
  if (!fields || !input || Array.isArray(input) || typeof input !== "object" || Object.keys(input).some(key => !fields.includes(key)))
    throw subscriberError("SUBSCRIBER_BODY_INVALID");
  return input;
}
export function subscriberErrorStatus(code) {
  if (["SUBSCRIBER_ACCESS_DENIED", "SUBSCRIBER_ORIGIN_INVALID"].includes(code)) return 403;
  if (["SUBSCRIBER_DRAFT_CHANGED", "SUBSCRIBER_RETRY_CHANGED"].includes(code)) return 409;
  return 400;
}

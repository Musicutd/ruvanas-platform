import { retailSubscriberError } from "./retail-subscriber-service.mjs";

export function retailSubscriberQuery(request, fields) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !fields.includes(key) || params.getAll(key).length !== 1)) throw retailSubscriberError("SUBSCRIBER_QUERY_INVALID");
  const query = Object.fromEntries(params);
  if (query.channelId !== undefined && !/^[a-zA-Z0-9_-]{1,191}$/.test(query.channelId)) throw retailSubscriberError("SUBSCRIBER_QUERY_INVALID");
  return query;
}
export async function retailSubscriberCommand(request, kind) {
  if (request.headers.get("origin") !== "https://www.ruvanas.com" || request.headers.get("sec-fetch-site") === "cross-site")
    throw retailSubscriberError("SUBSCRIBER_ORIGIN_INVALID");
  const maximum = kind === "schedule" ? 128 * 1024 : 4096;
  const size = request.headers.get("content-length");
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "") ||
    (size !== null && (!/^\d+$/.test(size) || Number(size) > maximum))) throw retailSubscriberError("SUBSCRIBER_BODY_INVALID");
  const reader = request.body?.getReader();
  if (!reader) throw retailSubscriberError("SUBSCRIBER_BODY_INVALID");
  const chunks = []; let bytes = 0;
  while (true) {
    const result = await reader.read(); if (result.done) break;
    bytes += result.value.byteLength;
    if (bytes > maximum) { void reader.cancel().catch(() => {}); throw retailSubscriberError("SUBSCRIBER_BODY_INVALID"); }
    chunks.push(result.value);
  }
  let input;
  try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw retailSubscriberError("SUBSCRIBER_BODY_INVALID"); }
  const fields = kind === "workspace" && input?.action === "prepare" ? ["action", "requestId"] :
    kind === "schedule" && input?.action === "save" ? ["action", "channelId", "name", "timezone", "items", "requestId", "baseVersionId"] :
    kind === "library" && input?.action === "preview" ? ["action", "name", "buildMode", "genreCodes", "durationMinutes", "seed"] :
    kind === "library" && input?.action === "save" ? ["action", "name", "buildMode", "genreCodes", "durationMinutes", "requestId"] : null;
  if (!fields || !input || Array.isArray(input) || typeof input !== "object" || Object.keys(input).some(key => !fields.includes(key)))
    throw retailSubscriberError("SUBSCRIBER_BODY_INVALID");
  return input;
}
export function retailSubscriberErrorStatus(code) {
  if (["SUBSCRIBER_ACCESS_DENIED", "SUBSCRIBER_ORIGIN_INVALID", "SUBSCRIBER_MUSIC_ACCESS_REQUIRED"].includes(code)) return 403;
  if (["SUBSCRIBER_DRAFT_CHANGED", "SUBSCRIBER_RETRY_CHANGED", "SUBSCRIBER_WORKSPACE_REVIEW_REQUIRED", "SUBSCRIBER_STATION_LIMIT"].includes(code)) return 409;
  if (code === "SUBSCRIBER_REQUEST_FAILED") return 503;
  return 400;
}

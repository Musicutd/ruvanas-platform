import crypto from "node:crypto";

export const LISTENER_REQUEST_ACTIONS = ["APPROVE", "REJECT", "MARK_PLAYED", "ARCHIVE", "UNBLOCK"];
export const LISTENER_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "PLAYED", "ARCHIVED"];
export const LISTENER_REQUEST_RATE_LIMIT = 5;
export const LISTENER_REQUEST_RATE_WINDOW_MS = 60 * 60 * 1_000;
export const LISTENER_REQUEST_DEDUPE_WINDOW_MS = 30 * 60 * 1_000;

const URL_OR_CONTACT = /(?:https?:\/\/|www\.|\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b)/i;
const CONTROL = /[\u0000-\u001f\u007f]/g;

function cleanText(value, field, { min = 1, max }) {
  const text = String(value || "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (text.length < min || text.length > max) throw new Error(`${field} must contain between ${min} and ${max} characters.`);
  if (URL_OR_CONTACT.test(text)) throw new Error(`${field} cannot contain links or contact details.`);
  if (/(.)\1{9,}/u.test(text)) throw new Error(`${field} contains too many repeated characters.`);
  return text;
}

export function normalizeListenerRequestSettings(input = {}) {
  const instructions = input.instructions == null || String(input.instructions).trim() === ""
    ? null
    : cleanText(input.instructions, "Request instructions", { min: 1, max: 240 });
  return { enabled: input.enabled === true, instructions };
}

export function normalizeListenerRequest(input = {}) {
  const artist = cleanText(input.artist, "Artist", { min: 1, max: 100 });
  const title = cleanText(input.title, "Title", { min: 1, max: 140 });
  const message = input.message == null || String(input.message).trim() === ""
    ? null
    : cleanText(input.message, "Message", { min: 1, max: 240 });
  return { artist, title, message };
}

export function createListenerRequestDedupeKey({ stationId, sessionHash, artist, title, instant = new Date(), secret }) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  const bucket = Math.floor(instant.getTime() / LISTENER_REQUEST_DEDUPE_WINDOW_MS);
  const normalized = `${stationId}|${sessionHash}|${artist.toLowerCase()}|${title.toLowerCase()}|${bucket}`;
  return crypto.createHmac("sha256", secret).update(`listener-request:${normalized}`).digest("hex");
}

export function listenerRequestTransition(currentStatus, action, note = "") {
  const status = String(currentStatus || "").toUpperCase();
  const nextAction = String(action || "").toUpperCase();
  const reviewNote = String(note || "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (!LISTENER_REQUEST_ACTIONS.includes(nextAction) || nextAction === "UNBLOCK") throw new Error("Choose a supported moderation action.");
  if (reviewNote.length > 500) throw new Error("The moderation note must be 500 characters or fewer.");
  if (nextAction === "APPROVE" && status === "PENDING") return { status: "APPROVED", reviewNote: reviewNote || null };
  if (nextAction === "REJECT" && status === "PENDING") {
    if (reviewNote.length < 3) throw new Error("Add a short reason before rejecting a request.");
    return { status: "REJECTED", reviewNote };
  }
  if (nextAction === "MARK_PLAYED" && status === "APPROVED") return { status: "PLAYED", reviewNote: reviewNote || null };
  if (nextAction === "ARCHIVE" && ["REJECTED", "PLAYED"].includes(status)) return { status: "ARCHIVED", reviewNote: reviewNote || null };
  throw new Error(`This request cannot be ${nextAction.toLowerCase().replaceAll("_", " ")} from ${status.toLowerCase()}.`);
}

export function safeListenerRequest(record, blocked = false) {
  return {
    id: record.id,
    artist: record.artist,
    title: record.title,
    message: record.message,
    status: record.status,
    blocked,
    reviewNote: record.reviewNote,
    reviewedAt: record.reviewedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

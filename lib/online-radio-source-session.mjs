// Durable source-run lifecycle guard. These are not listener or royalty records.
// Importing this module opens no resources and performs no database operations.
export const SOURCE_SESSION_OPEN_ACTION = "ONLINE_RADIO_SOURCE_RUN_OPEN";
export const SOURCE_SESSION_CLOSED_ACTION = "ONLINE_RADIO_SOURCE_RUN_CLOSED";
const EVIDENCE_KIND = "SOURCE_CONNECTION_LIFECYCLE";
const KEYS = ["organisationId", "stationId", "destinationId", "sessionId"];
const SELECT = Object.freeze({ id: true, organisationId: true, action: true, entityType: true, entityId: true, details: true, createdAt: true });
const fail = code => Object.assign(new Error(code), { code });
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const canonical = value => JSON.stringify(value === null || typeof value !== "object" ? value :
  Array.isArray(value) ? value.map(item => JSON.parse(canonical(item))) :
    Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])));

function checkedIdentity(input, scopeOnly = false) {
  const keys = scopeOnly ? KEYS.slice(0, 3) : KEYS;
  if (!isRecord(input) || Object.keys(input).length !== keys.length || Object.keys(input).some(key => !keys.includes(key))) throw fail("SOURCE_SESSION_IDENTITY_INVALID");
  const identity = {};
  for (const key of keys) {
    if (typeof input[key] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input[key])) throw fail("SOURCE_SESSION_IDENTITY_INVALID");
    identity[key] = input[key];
  }
  return identity;
}

function timeoutOption(input = {}) {
  if (!isRecord(input) || Object.keys(input).some(key => key !== "timeoutMs")) throw fail("SOURCE_SESSION_OPTIONS_INVALID");
  const timeoutMs = input.timeoutMs ?? 2000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw fail("SOURCE_SESSION_OPTIONS_INVALID");
  return timeoutMs;
}

export function sourceSessionAuditIds(input) {
  const identity = checkedIdentity(input);
  const prefix = `or_source_run:${KEYS.map(key => identity[key]).join(":")}`;
  return Object.freeze({ openId: `${prefix}:OPEN`, closedId: `${prefix}:CLOSED` });
}

function detailsFor(identity, closed) {
  const { openId, closedId } = sourceSessionAuditIds(identity);
  return { schemaVersion: 1, evidenceKind: EVIDENCE_KIND, ...identity,
    openAuditId: openId, closureAuditId: closedId, sourceState: closed ? "RUN_CLOSED" : "RUN_OPEN",
    stopConfirmed: closed, ledgerDrained: closed, listenerProof: false, royaltyConfirmed: false };
}

function validateRow(row, identity, closed) {
  const ids = sourceSessionAuditIds(identity), expectedId = closed ? ids.closedId : ids.openId;
  if (!isRecord(row) || Object.keys(row).some(key => !Object.hasOwn(SELECT, key)) ||
      row.id !== expectedId || row.organisationId !== identity.organisationId || row.entityType !== "Station" || row.entityId !== identity.stationId ||
      row.action !== (closed ? SOURCE_SESSION_CLOSED_ACTION : SOURCE_SESSION_OPEN_ACTION) ||
      !isRecord(row.details) || canonical(row.details) !== canonical(detailsFor(identity, closed)) ||
      !(row.createdAt instanceof Date || typeof row.createdAt === "string") || !Number.isFinite(new Date(row.createdAt).getTime())) throw fail("SOURCE_SESSION_MARKER_CONFLICT");
  return true;
}

async function bounded(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(fail("SOURCE_SESSION_DATABASE_TIMEOUT")), timeoutMs);
    })]);
  } catch (error) {
    throw fail(/^SOURCE_SESSION_[A-Z_]+$/.test(error?.code ?? "") ? error.code : "SOURCE_SESSION_DATABASE_FAILED");
  } finally { clearTimeout(timer); }
}

async function appendMarker(db, identity, closed, timeoutMs, notBefore = null) {
  const { openId, closedId } = sourceSessionAuditIds(identity), id = closed ? closedId : openId;
  const row = await bounded(() => db.auditLog.upsert({ where: { id }, update: {}, select: SELECT,
    create: { id, organisationId: identity.organisationId,
      action: closed ? SOURCE_SESSION_CLOSED_ACTION : SOURCE_SESSION_OPEN_ACTION,
      entityType: "Station", entityId: identity.stationId, details: detailsFor(identity, closed) } }), timeoutMs);
  validateRow(row, identity, closed);
  if (notBefore !== null && new Date(row.createdAt).getTime() < new Date(notBefore).getTime()) throw fail("SOURCE_SESSION_MARKER_CONFLICT");
  return Object.freeze({ recorded: true, id, sourceState: closed ? "RUN_CLOSED" : "RUN_OPEN", listenerProof: false, royaltyConfirmed: false });
}

// The caller must hold the station's exclusive encoder lease and call the guard
// before allocating a fresh random runtime session. An OPEN retry is idempotent;
// a reused, already CLOSED session is never allowed to reopen.
export async function openSourceSession(db, input, options = {}) {
  const identity = checkedIdentity(input), timeoutMs = timeoutOption(options);
  if (typeof db?.auditLog?.upsert !== "function" || typeof db?.auditLog?.findUnique !== "function") throw fail("SOURCE_SESSION_DATABASE_INVALID");
  const existing = await bounded(() => db.auditLog.findUnique({ where: { id: sourceSessionAuditIds(identity).closedId }, select: SELECT }), timeoutMs);
  if (existing !== null && existing !== undefined) {
    validateRow(existing, identity, true);
    throw fail("SOURCE_SESSION_ALREADY_CLOSED");
  }
  return appendMarker(db, identity, false, timeoutMs);
}

export async function closeSourceSession(db, input, options) {
  const identity = checkedIdentity(input);
  if (!isRecord(options) || Object.keys(options).some(key => !["stopConfirmed", "ledgerDrained", "timeoutMs"].includes(key)) ||
      options.stopConfirmed !== true || options.ledgerDrained !== true) throw fail("SOURCE_SESSION_CLOSE_NOT_CONFIRMED");
  const timeoutMs = timeoutOption({ timeoutMs: options.timeoutMs });
  if (typeof db?.auditLog?.upsert !== "function" || typeof db?.auditLog?.findUnique !== "function") throw fail("SOURCE_SESSION_DATABASE_INVALID");
  const open = await bounded(() => db.auditLog.findUnique({ where: { id: sourceSessionAuditIds(identity).openId }, select: SELECT }), timeoutMs);
  if (!open) throw fail("SOURCE_SESSION_OPEN_MISSING");
  validateRow(open, identity, false);
  return appendMarker(db, identity, true, timeoutMs, open.createdAt);
}

export async function assertNoOpenSourceSession(db, input, options = {}) {
  const scope = checkedIdentity(input, true), timeoutMs = timeoutOption(options);
  if (typeof db?.$queryRaw !== "function") throw fail("SOURCE_SESSION_DATABASE_INVALID");
  // Parameterized values only. Closed history is excluded by a strict, matching
  // lifecycle marker BEFORE LIMIT, not by scanning just the latest N tracks.
  // Any malformed/unclosed marker for this station blocks all destinations.
  const rows = await bounded(() => db.$queryRaw`
    SELECT o.id, o."organisationId", o.action, o."entityType", o."entityId", o.details, o."createdAt"
    FROM "AuditLog" AS o
    WHERE o.action = 'ONLINE_RADIO_SOURCE_RUN_OPEN'
      AND o."organisationId" = ${scope.organisationId}
      AND o."entityId" = ${scope.stationId}
      AND NOT EXISTS (
        SELECT 1 FROM "AuditLog" AS c
        WHERE o."entityType" = 'Station'
          AND (o.details->>'destinationId') ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
          AND (o.details->>'sessionId') ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
          AND o.id = 'or_source_run:' || o."organisationId" || ':' || o."entityId" || ':' || (o.details->>'destinationId') || ':' || (o.details->>'sessionId') || ':OPEN'
          AND c.id = 'or_source_run:' || o."organisationId" || ':' || o."entityId" || ':' || (o.details->>'destinationId') || ':' || (o.details->>'sessionId') || ':CLOSED'
          AND c.action = 'ONLINE_RADIO_SOURCE_RUN_CLOSED'
          AND c."organisationId" = o."organisationId" AND c."entityType" = 'Station' AND c."entityId" = o."entityId"
          AND c."createdAt" >= o."createdAt"
          AND o.details = jsonb_build_object(
            'schemaVersion', 1, 'evidenceKind', 'SOURCE_CONNECTION_LIFECYCLE',
            'organisationId', o."organisationId", 'stationId', o."entityId",
            'destinationId', o.details->>'destinationId', 'sessionId', o.details->>'sessionId',
            'openAuditId', o.id, 'closureAuditId', c.id, 'sourceState', 'RUN_OPEN',
            'stopConfirmed', false, 'ledgerDrained', false, 'listenerProof', false, 'royaltyConfirmed', false)
          AND c.details = jsonb_build_object(
            'schemaVersion', 1, 'evidenceKind', 'SOURCE_CONNECTION_LIFECYCLE',
            'organisationId', o."organisationId", 'stationId', o."entityId",
            'destinationId', o.details->>'destinationId', 'sessionId', o.details->>'sessionId',
            'openAuditId', o.id, 'closureAuditId', c.id, 'sourceState', 'RUN_CLOSED',
            'stopConfirmed', true, 'ledgerDrained', true, 'listenerProof', false, 'royaltyConfirmed', false)
      )
    ORDER BY o."createdAt" ASC, o.id ASC
    LIMIT 2
  `, timeoutMs);
  if (!Array.isArray(rows) || rows.length > 2) throw fail("SOURCE_SESSION_QUERY_INVALID");
  for (const row of rows) {
    let identity;
    try { identity = checkedIdentity(Object.fromEntries(KEYS.map(key => [key, row?.details?.[key]]))); }
    catch { throw fail("SOURCE_SESSION_MARKER_CONFLICT"); }
    validateRow(row, identity, false);
    if (identity.organisationId !== scope.organisationId || identity.stationId !== scope.stationId || identity.destinationId !== scope.destinationId) throw fail("SOURCE_SESSION_SCOPE_MISMATCH");
  }
  if (rows.length) throw fail("SOURCE_SESSION_UNCLOSED");
  return Object.freeze({ clear: true, unclosedSourceRuns: 0, listenerProof: false, royaltyConfirmed: false });
}

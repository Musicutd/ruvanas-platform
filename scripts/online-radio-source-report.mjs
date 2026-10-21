// Read-only operational source-send export, never a listener or royalty report.
// Default/--check imports no database client and performs no external operation.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deliveryEventId, senderUsageRows, validateDeliveryEvent,
  ONLINE_RADIO_DELIVERY_ACTION } from "../lib/online-radio-delivery-ledger.mjs";

const LIMIT = 10000;
const SESSION_CHUNK = 50;
const SELECTION_BASIS = "WHOLE_SEGMENTS_WITH_EVENT_IN_WINDOW";
const EVIDENCE_KIND = "SOURCE_DELIVERY_DIAGNOSTIC";
const SELECT = Object.freeze({ id: true, organisationId: true, action: true, entityType: true, entityId: true, details: true, createdAt: true });
const PHASE = Object.freeze({ STARTED: 0, AUDIO_SENT: 1, ENDED: 2, INTERRUPTED: 2, FAILED: 2 });
const fail = code => Object.assign(new Error(code), { code });
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const segmentKey = event => JSON.stringify([event.organisationId, event.stationId, event.destinationId, event.sessionId, event.segmentSequence]);
const sessionKey = event => JSON.stringify([event.organisationId, event.stationId, event.destinationId, event.sessionId]);

function iso(value) {
  // UTC ISO timestamps only, with optional millisecond precision. Reject Date's
  // normalization of impossible calendar dates instead of silently widening a window.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) throw fail("SOURCE_REPORT_WINDOW_INVALID");
  const date = new Date(value), expected = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction = "") => `.${fraction.padEnd(3, "0")}Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== expected) throw fail("SOURCE_REPORT_WINDOW_INVALID");
  return date.toISOString();
}

export function validateSenderReportParams(input) {
  if (!isRecord(input) || Object.keys(input).some(key => !["stationId", "organisationId", "from", "to", "maxEvents"].includes(key)) ||
      !/^c[a-z0-9]{24}$/i.test(input.stationId ?? "") || !/^c[a-z0-9]{24}$/i.test(input.organisationId ?? "")) throw fail("SOURCE_REPORT_SCOPE_INVALID");
  const from = iso(input.from), to = iso(input.to), maxEvents = input.maxEvents ?? LIMIT;
  if (from >= to || !Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > LIMIT) throw fail("SOURCE_REPORT_WINDOW_INVALID");
  return Object.freeze({ stationId: input.stationId, organisationId: input.organisationId, from, to, maxEvents });
}

function auditedEvent(row, params) {
  if (!isRecord(row) || Object.keys(row).some(key => !Object.hasOwn(SELECT, key)) ||
      row.action !== ONLINE_RADIO_DELIVERY_ACTION || row.entityType !== "Station" || row.entityId !== params.stationId ||
      row.organisationId !== params.organisationId || !isRecord(row.details) ||
      Object.keys(row.details).sort().join(",") !== "event,evidenceKind,listenerProof,royaltyConfirmed,schemaVersion" ||
      row.details.schemaVersion !== 1 || row.details.evidenceKind !== EVIDENCE_KIND || row.details.listenerProof !== false ||
      row.details.royaltyConfirmed !== false) throw fail("SOURCE_REPORT_AUDIT_CONTEXT_INVALID");
  let event;
  try { event = validateDeliveryEvent(row.details.event); }
  catch { throw fail("SOURCE_REPORT_EVENT_INVALID"); }
  if (event.stationId !== params.stationId || event.organisationId !== params.organisationId || row.id !== deliveryEventId(event) ||
      !(row.createdAt instanceof Date || typeof row.createdAt === "string") ||
      !Number.isFinite(new Date(row.createdAt).getTime()) || new Date(row.createdAt).toISOString() !== event.eventAt) throw fail("SOURCE_REPORT_AUDIT_CONTEXT_INVALID");
  return event;
}

function ordered(events) {
  return [...events].sort((a, b) => sessionKey(a).localeCompare(sessionKey(b)) ||
    a.segmentSequence - b.segmentSequence || PHASE[a.type] - PHASE[b.type]);
}

function selectedRows(events, selectedSegments) {
  // Validate complete original sessions before selecting any segment. This also
  // rejects missing starts, regressed timestamps/counters and conflicting phases.
  senderUsageRows(events);
  const segments = new Map();
  for (const event of events) {
    const key = segmentKey(event);
    if (!selectedSegments.has(key)) continue;
    if (!segments.has(key)) segments.set(key, []);
    segments.get(key).push(event);
  }
  const grouped = new Map();
  for (const segment of segments.values()) {
    // Sequence normalization is only for a pure one-segment summary after the
    // original session was validated. No audit/event identity is exported or changed.
    const [summary] = senderUsageRows(segment.map(event => ({ ...event, segmentSequence: 1 })));
    const key = JSON.stringify([summary.organisationId, summary.stationId, summary.destinationId, summary.trackId, summary.mediaAssetId]);
    if (!grouped.has(key)) grouped.set(key, { ...summary, sessions: new Set([segment[0].sessionId]) });
    else {
      const row = grouped.get(key);
      for (const count of ["startedSegments", "endedSegments", "interruptedSegments", "failedSegments", "unresolvedSegments", "audioObservedSegments",
        "segmentsWithoutByteMeasurement", "segmentsWithoutSecondMeasurement", "unknownSegments"]) row[count] += summary[count];
      for (const amount of ["observedTransmittedBytes", "observedTransmittedSeconds"]) {
        if (summary[amount] !== null) row[amount] = (row[amount] ?? 0) + summary[amount];
      }
      row.sessions.add(segment[0].sessionId);
      row.observationBases = [...new Set([...row.observationBases, ...summary.observationBases])].sort();
      row.lowerBoundOnly ||= summary.lowerBoundOnly;
      if (summary.firstEventAt < row.firstEventAt) row.firstEventAt = summary.firstEventAt;
      if (summary.lastEventAt > row.lastEventAt) row.lastEventAt = summary.lastEventAt;
    }
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => {
    const { sessions, ...values } = row;
    return Object.freeze({ ...values, sessionCount: sessions.size, selectionBasis: SELECTION_BASIS,
      sourceCompletionStatus: row.unknownSegments ? "UNKNOWN" : "TERMINAL_EVENTS_RECORDED" });
  });
}

export async function loadSenderReport(db, input) {
  const params = validateSenderReportParams(input);
  if (typeof db?.$transaction !== "function") throw fail("SOURCE_REPORT_DATABASE_INVALID");
  try {
    return await db.$transaction(async tx => {
      if (typeof tx?.$executeRawUnsafe !== "function" || typeof tx?.auditLog?.findMany !== "function") throw fail("SOURCE_REPORT_DATABASE_INVALID");
      // Fixed literal, no user interpolation and no data-changing SQL.
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const scope = { action: ONLINE_RADIO_DELIVERY_ACTION, entityType: "Station", entityId: params.stationId, organisationId: params.organisationId };
      const windowRows = await tx.auditLog.findMany({ where: { ...scope, createdAt: { gte: new Date(params.from), lt: new Date(params.to) } },
        select: SELECT, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: params.maxEvents + 1 });
      if (!Array.isArray(windowRows) || windowRows.length > params.maxEvents) throw fail("SOURCE_REPORT_OVERFLOW");
      const windowEvents = windowRows.map(row => auditedEvent(row, params));
      if (new Set(windowEvents.map(deliveryEventId)).size !== windowEvents.length) throw fail("SOURCE_REPORT_SESSION_CONTEXT_INVALID");
      if (windowEvents.some(event => event.eventAt < params.from || event.eventAt >= params.to)) throw fail("SOURCE_REPORT_WINDOW_CONTEXT_INVALID");
      const sessionIds = [...new Set(windowEvents.map(event => event.sessionId))].sort();
      const records = new Map();
      const destinationBySession = new Map();
      for (let offset = 0; offset < sessionIds.length; offset += SESSION_CHUNK) {
        const chunk = sessionIds.slice(offset, offset + SESSION_CHUNK);
        const rows = await tx.auditLog.findMany({ where: { ...scope,
          OR: chunk.map(sessionId => ({ details: { path: ["event", "sessionId"], equals: sessionId } })) },
        select: SELECT, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: params.maxEvents - records.size + 1 });
        if (!Array.isArray(rows) || rows.length > params.maxEvents - records.size) throw fail("SOURCE_REPORT_OVERFLOW");
        for (const row of rows) {
          const event = auditedEvent(row, params);
          if (!chunk.includes(event.sessionId) || records.has(row.id)) throw fail("SOURCE_REPORT_SESSION_CONTEXT_INVALID");
          if (destinationBySession.has(event.sessionId) && destinationBySession.get(event.sessionId) !== event.destinationId) throw fail("SOURCE_REPORT_SESSION_CONTEXT_INVALID");
          destinationBySession.set(event.sessionId, event.destinationId);
          records.set(row.id, event);
        }
      }
      for (const event of windowEvents) {
        const found = records.get(deliveryEventId(event));
        if (!found || JSON.stringify(found) !== JSON.stringify(event)) throw fail("SOURCE_REPORT_SESSION_TRUNCATED");
      }
      const events = ordered([...records.values()]);
      let rows;
      try { rows = selectedRows(events, new Set(windowEvents.map(segmentKey))); }
      catch { throw fail("SOURCE_REPORT_SESSION_INCONSISTENT"); }
      return Object.freeze({ schemaVersion: 1, evidenceKind: EVIDENCE_KIND, listenerProof: false, royaltyConfirmed: false,
        selectionBasis: SELECTION_BASIS, scope: { stationId: params.stationId, organisationId: params.organisationId,
          fromInclusive: params.from, toExclusive: params.to }, contextEventCount: events.length,
        selectedWindowEventCount: windowEvents.length, rows });
    }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 15000 });
  } catch (error) {
    if (typeof error?.code === "string" && /^SOURCE_REPORT_[A-Z_]+$/.test(error.code)) throw fail(error.code);
    throw fail("SOURCE_REPORT_READ_FAILED");
  }
}

function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[\s\x00-\x1f]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function safeCSV(rows, scope = {}) {
  if (!Array.isArray(rows) || rows.length > LIMIT) throw fail("SOURCE_REPORT_EXPORT_INVALID");
  const header = ["evidenceKind", "noListenerProof", "noRoyaltyConfirmed", "SOURCE_DELIVERY_DIAGNOSTIC_ONLY", "selectionBasis", "fromInclusive", "toExclusive",
    "organisationId", "stationId", "destinationId", "trackId", "mediaAssetId", "firstEventAt", "lastEventAt",
    "startedSegments", "audioObservedSegments", "endedSegments", "interruptedSegments", "failedSegments", "unknownSegments",
    "sourceCompletionStatus", "observedTransmittedBytes", "observedTransmittedSeconds", "lowerBoundOnly",
    "segmentsWithoutByteMeasurement", "segmentsWithoutSecondMeasurement", "sessionCount", "observationBases", "measurementMeaning"];
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    if (!isRecord(row) || row.evidenceKind !== EVIDENCE_KIND || row.listenerProof !== false || row.royaltyConfirmed !== false ||
        !Array.isArray(row.observationBases)) throw fail("SOURCE_REPORT_EXPORT_INVALID");
    for (const field of ["startedSegments", "audioObservedSegments", "endedSegments", "interruptedSegments", "failedSegments", "unknownSegments",
      "segmentsWithoutByteMeasurement", "segmentsWithoutSecondMeasurement", "sessionCount"]) {
      if (!Number.isSafeInteger(row[field]) || row[field] < 0) throw fail("SOURCE_REPORT_EXPORT_INVALID");
    }
    if (row.observedTransmittedBytes !== null && (!Number.isSafeInteger(row.observedTransmittedBytes) || row.observedTransmittedBytes < 0) ||
        row.observedTransmittedSeconds !== null && (!Number.isFinite(row.observedTransmittedSeconds) || row.observedTransmittedSeconds < 0)) throw fail("SOURCE_REPORT_EXPORT_INVALID");
    const values = { ...row, evidenceKind: EVIDENCE_KIND, noListenerProof: true, noRoyaltyConfirmed: true, SOURCE_DELIVERY_DIAGNOSTIC_ONLY: true,
      selectionBasis: SELECTION_BASIS, fromInclusive: scope.fromInclusive ?? "", toExclusive: scope.toExclusive ?? "",
      observationBases: row.observationBases.join(";") };
    lines.push(header.map(field => csvCell(values[field])).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export const safeSenderReportCsv = report => safeCSV(report.rows, report.scope);

export function parseSourceReportArguments(args) {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== "string")) throw fail("SOURCE_REPORT_ARGUMENTS_INVALID");
  if (!args.length || args.length === 1 && args[0] === "--check") return { mode: "CHECK" };
  if (args[0] !== "--report") throw fail("SOURCE_REPORT_ARGUMENTS_INVALID");
  const names = { "--station-id": "stationId", "--organisation-id": "organisationId", "--from": "from", "--to": "to" };
  const params = {};
  for (let index = 1; index < args.length; index += 2) {
    const name = names[args[index]], value = args[index + 1];
    if (!name || value === undefined || Object.hasOwn(params, name)) throw fail("SOURCE_REPORT_ARGUMENTS_INVALID");
    params[name] = value;
  }
  return { mode: "REPORT", params: validateSenderReportParams(params) };
}

export async function runSourceReportCli(args, { loadClient = async () => {
  const { PrismaClient } = await import("@prisma/client");
  return new PrismaClient();
}, stdout = value => process.stdout.write(value), stderr = value => process.stderr.write(value) } = {}) {
  let client;
  try {
    const command = parseSourceReportArguments(args);
    if (command.mode === "CHECK") {
      stdout(`${JSON.stringify({ ok: true, mode: "CHECK", databaseAccessed: false, readOnly: true,
        evidenceKind: EVIDENCE_KIND, listenerProof: false, royaltyConfirmed: false })}\n`);
      return 0;
    }
    client = await loadClient();
    stdout(safeSenderReportCsv(await loadSenderReport(client, command.params)));
    return 0;
  } catch (error) {
    const code = /^SOURCE_REPORT_[A-Z_]+$/.test(error?.code ?? "") ? error.code : "SOURCE_REPORT_READ_FAILED";
    stderr(`${JSON.stringify({ ok: false, code })}\n`);
    return 1;
  } finally { if (client && typeof client.$disconnect === "function") { try { await client.$disconnect(); } catch { /* no driver details */ } } }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await runSourceReportCli(process.argv.slice(2));
}

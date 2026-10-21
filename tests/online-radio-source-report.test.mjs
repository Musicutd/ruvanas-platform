import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deliveryEventId, ONLINE_RADIO_DELIVERY_ACTION } from "../lib/online-radio-delivery-ledger.mjs";
import { loadSenderReport, parseSourceReportArguments, runSourceReportCli, safeCSV, safeSenderReportCsv,
  validateSenderReportParams } from "../scripts/online-radio-source-report.mjs";

const stationId = "cmvcnbwi20008hr23sd76psi8", organisationId = "cmvcnbwi20008hr23sd76psi9";
const params = { stationId, organisationId, from: "2026-10-21T12:00:00Z", to: "2026-10-21T13:00:00Z" };
function event(type, segmentSequence = 1, extra = {}) {
  return { organisationId, stationId, destinationId: "destination-1", sessionId: "runtime-1", segmentSequence,
    type, trackId: `track-${segmentSequence}`, mediaAssetId: `asset-${segmentSequence}`,
    eventAt: type === "STARTED" ? "2026-10-21T11:59:59.000Z" : type === "AUDIO_SENT" ? "2026-10-21T12:00:00.000Z" : "2026-10-21T12:00:10.000Z",
    transmittedBytes: type === "STARTED" ? null : type === "AUDIO_SENT" ? 418 : 4180,
    transmittedSeconds: type === "STARTED" ? null : type === "AUDIO_SENT" ? 1152 / 44100 : 11520 / 44100,
    observationBasis: type === "STARTED" ? null : "SOURCE_WRITE_CALLBACK", reasonCode: ["STARTED", "AUDIO_SENT"].includes(type) ? null : "SOURCE_FILE_ENDED", ...extra };
}
function audit(e) {
  return { id: deliveryEventId(e), organisationId, action: ONLINE_RADIO_DELIVERY_ACTION, entityType: "Station", entityId: stationId,
    details: { schemaVersion: 1, evidenceKind: "SOURCE_DELIVERY_DIAGNOSTIC", listenerProof: false, royaltyConfirmed: false, event: e }, createdAt: new Date(e.eventAt) };
}
function fixture(rows = [audit(event("STARTED")), audit(event("AUDIO_SENT")), audit(event("ENDED"))], mutateResult) {
  const calls = [], sql = [], transactions = [];
  const db = { async $transaction(callback, options) {
    transactions.push(options);
    return callback({ async $executeRawUnsafe(...args) { sql.push(args); }, auditLog: { async findMany(query) {
      calls.push(query);
      let result = rows.filter(row => {
        const w = query.where;
        if (row.action !== w.action || row.organisationId !== w.organisationId || row.entityType !== w.entityType || row.entityId !== w.entityId) return false;
        if (w.createdAt) return row.createdAt >= w.createdAt.gte && row.createdAt < w.createdAt.lt;
        return w.OR.some(term => term.details.equals === row.details.event.sessionId);
      }).slice(0, query.take);
      if (mutateResult) result = mutateResult(result, calls.length, query);
      return structuredClone(result);
    } } });
  } };
  return { db, calls, sql, transactions };
}
const rejectsCode = (promise, code) => assert.rejects(promise, { code });

test("default and explicit check modes open no client, database, storage, source or file", async () => {
  for (const args of [[], ["--check"]]) {
    const output = [], errors = []; let clients = 0;
    assert.equal(await runSourceReportCli(args, { loadClient: async () => { clients += 1; throw new Error("must not run"); }, stdout: text => output.push(text), stderr: text => errors.push(text) }), 0);
    assert.equal(clients, 0); assert.equal(errors.length, 0);
    assert.equal(JSON.parse(output[0]).databaseAccessed, false);
  }
  const script = fileURLToPath(new URL("../scripts/online-radio-source-report.mjs", import.meta.url));
  const child = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8", timeout: 3000,
    env: { ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), DATABASE_URL: "this-must-not-be-read" } });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).mode, "CHECK");
});

test("scope and UTC inclusive/exclusive window must be explicit and valid before any access", async () => {
  assert.equal(validateSenderReportParams(params).from, "2026-10-21T12:00:00.000Z");
  for (const extra of [{ stationId: "other" }, { organisationId: undefined }, { from: "2026-02-30T12:00:00Z" }, { to: params.from },
    { from: "2026-10-21" }, { maxEvents: 10001 }, { password: "hidden" }]) assert.throws(() => validateSenderReportParams({ ...params, ...extra }));
  const f = fixture();
  await assert.rejects(loadSenderReport(f.db, { ...params, stationId: undefined }));
  assert.equal(f.transactions.length, 0);
  assert.throws(() => parseSourceReportArguments(["--report"]));
  assert.throws(() => parseSourceReportArguments(["--check", "--report"]));
});

test("report uses a read-only snapshot and full session context for a segment started before the window", async () => {
  const f = fixture();
  const report = await loadSenderReport(f.db, params);
  assert.deepEqual(f.sql, [["SET TRANSACTION READ ONLY"]]);
  assert.equal(f.transactions[0].isolationLevel, "RepeatableRead");
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[0].where.createdAt, { gte: new Date(params.from), lt: new Date(params.to) });
  assert.deepEqual(f.calls[1].where.OR, [{ details: { path: ["event", "sessionId"], equals: "runtime-1" } }]);
  assert.equal(report.contextEventCount, 3);
  assert.equal(report.selectedWindowEventCount, 2);
  assert.equal(report.rows[0].observedTransmittedBytes, 4180);
  assert.equal(report.rows[0].firstEventAt, "2026-10-21T11:59:59.000Z");
  assert.equal(report.rows[0].endedSegments, 1);
  assert.equal(report.listenerProof, false); assert.equal(report.royaltyConfirmed, false);
});

test("unrelated out-of-window segments are validated as context but excluded from totals", async () => {
  const rows = [audit(event("STARTED")), audit(event("AUDIO_SENT")), audit(event("ENDED")),
    audit(event("STARTED", 2, { eventAt: "2026-10-21T13:00:00.000Z" })),
    audit(event("AUDIO_SENT", 2, { eventAt: "2026-10-21T13:00:01.000Z" })),
    audit(event("ENDED", 2, { eventAt: "2026-10-21T13:00:10.000Z" }))];
  const report = await loadSenderReport(fixture(rows).db, params);
  assert.equal(report.contextEventCount, 6);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].trackId, "track-1");
  assert.equal(report.rows[0].selectionBasis, "WHOLE_SEGMENTS_WITH_EVENT_IN_WINDOW");
});

test("window events at the inclusive start are included and exclusive end are excluded", async () => {
  const report = await loadSenderReport(fixture().db, { ...params, to: "2026-10-21T12:00:10Z" });
  assert.equal(report.selectedWindowEventCount, 1);
  assert.equal(report.rows[0].observedTransmittedBytes, 4180); // whole selected segment, explicitly not an apportioned window total
  assert.equal(report.scope.toExclusive, "2026-10-21T12:00:10.000Z");
});

test("same-millisecond phases are reconciled by segment order, never random audit ID order", async () => {
  const instant = "2026-10-21T12:00:00.000Z";
  const rows = [audit(event("ENDED", 1, { eventAt: instant })), audit(event("AUDIO_SENT", 1, { eventAt: instant })), audit(event("STARTED", 1, { eventAt: instant }))];
  assert.equal((await loadSenderReport(fixture(rows).db, params)).rows[0].endedSegments, 1);
});

test("missing terminal remains unknown and only observed first-write lower bounds are exported", async () => {
  const report = await loadSenderReport(fixture([audit(event("STARTED")), audit(event("AUDIO_SENT"))]).db, params);
  assert.equal(report.rows[0].unknownSegments, 1);
  assert.equal(report.rows[0].observedTransmittedBytes, 418);
  assert.equal(report.rows[0].lowerBoundOnly, true);
  assert.equal(report.rows[0].sourceCompletionStatus, "UNKNOWN");
});

test("foreign and tampered audit context cannot escape query scoping through malformed results", async () => {
  const mutations = [row => ({ ...row, organisationId: "cforeignforeignforeignfore" }), row => ({ ...row, entityId: "other" }),
    row => ({ ...row, action: "PROOF_OF_PLAY" }), row => ({ ...row, id: "forged" }),
    row => ({ ...row, details: { ...row.details, listenerProof: true } }),
    row => ({ ...row, details: { ...row.details, credential: "must-not-export" } }),
    row => ({ ...row, createdAt: new Date("2026-10-21T12:00:02Z") }),
    row => ({ ...row, details: { ...row.details, event: { ...row.details.event, stationId: "other" } } })];
  for (const mutate of mutations) {
    const f = fixture(undefined, (rows, call) => call === 1 ? rows.map((row, index) => index ? row : mutate(row)) : rows);
    await rejectsCode(loadSenderReport(f.db, params), "SOURCE_REPORT_AUDIT_CONTEXT_INVALID");
  }
  const secret = fixture(undefined, rows => rows.map(row => ({ ...row, details: { ...row.details, event: { ...row.details.event, storageKey: "private/key" } } })));
  await rejectsCode(loadSenderReport(secret.db, params), "SOURCE_REPORT_EVENT_INVALID");
});

test("truncated session and overflow reports fail instead of returning plausible partial totals", async () => {
  await rejectsCode(loadSenderReport(fixture([audit(event("AUDIO_SENT")), audit(event("ENDED"))]).db, params), "SOURCE_REPORT_SESSION_INCONSISTENT");
  const missing = fixture(undefined, (rows, call) => call === 2 ? rows.filter(row => row.details.event.type !== "AUDIO_SENT") : rows);
  await rejectsCode(loadSenderReport(missing.db, params), "SOURCE_REPORT_SESSION_TRUNCATED");
  await rejectsCode(loadSenderReport(fixture().db, { ...params, maxEvents: 1 }), "SOURCE_REPORT_OVERFLOW");
  await rejectsCode(loadSenderReport(fixture().db, { ...params, maxEvents: 2 }), "SOURCE_REPORT_OVERFLOW");
});

test("inconsistent session destination, monotonic counters and duplicate query records are rejected", async () => {
  const badDestination = fixture(undefined, (rows, call) => call === 2 ? rows.map(row => {
    if (row.details.event.type !== "ENDED") return row;
    return audit({ ...row.details.event, destinationId: "changed-destination" });
  }) : rows);
  await rejectsCode(loadSenderReport(badDestination.db, params), "SOURCE_REPORT_SESSION_CONTEXT_INVALID");
  const regressed = [audit(event("STARTED")), audit(event("AUDIO_SENT")), audit(event("ENDED", 1, { transmittedBytes: 100 }))];
  await rejectsCode(loadSenderReport(fixture(regressed).db, params), "SOURCE_REPORT_SESSION_INCONSISTENT");
  const duplicate = fixture(undefined, (rows, call) => call === 2 ? [...rows, rows[0]] : rows);
  await rejectsCode(loadSenderReport(duplicate.db, params), "SOURCE_REPORT_SESSION_CONTEXT_INVALID");
  const duplicateWindow = fixture(undefined, (rows, call) => call === 1 ? [...rows, rows[0]] : rows);
  await rejectsCode(loadSenderReport(duplicateWindow.db, params), "SOURCE_REPORT_SESSION_CONTEXT_INVALID");
});

test("CSV allowlists columns, escapes formulas, and states source-only evidence on every row", async () => {
  const report = await loadSenderReport(fixture().db, params);
  const csv = safeSenderReportCsv(report);
  assert.match(csv, /"evidenceKind","noListenerProof","noRoyaltyConfirmed"/);
  assert.match(csv, /"SOURCE_DELIVERY_DIAGNOSTIC","true","true"/);
  assert.match(csv, /WHOLE_SEGMENTS_WITH_EVENT_IN_WINDOW/);
  const malicious = { ...report.rows[0], trackId: "=HYPERLINK(\"bad\")", mediaAssetId: " \t@formula", privatePassword: "never-export" };
  const escaped = safeCSV([malicious]);
  assert.match(escaped, /"'=HYPERLINK\(""bad""\)"/);
  assert.match(escaped, /"' \t@formula"/);
  assert.doesNotMatch(escaped, /never-export|privatePassword/);
  assert.throws(() => safeCSV([{ ...report.rows[0], listenerProof: true }]));
  assert.throws(() => safeCSV([{ ...report.rows[0], observedTransmittedBytes: NaN }]));
});

test("empty results need no session lookup and remain a source-only header, never a success attestation", async () => {
  const f = fixture([]), report = await loadSenderReport(f.db, params);
  assert.equal(f.calls.length, 1); assert.deepEqual(report.rows, []);
  assert.equal(safeSenderReportCsv(report).trim().split(/\r?\n/).length, 1);
  assert.match(safeSenderReportCsv(report), /SOURCE_DELIVERY_DIAGNOSTIC_ONLY/);
});

test("database failures and CLI errors never expose raw credentials or driver text", async () => {
  const secretDb = { async $transaction() { throw new Error("postgres://user:secret@private-host/database"); } };
  await rejectsCode(loadSenderReport(secretDb, params), "SOURCE_REPORT_READ_FAILED");
  const output = [], errors = []; let disconnected = false;
  const args = ["--report", "--station-id", stationId, "--organisation-id", organisationId, "--from", params.from, "--to", params.to];
  assert.equal(await runSourceReportCli(args, { loadClient: async () => ({ ...secretDb, async $disconnect() { disconnected = true; } }), stdout: text => output.push(text), stderr: text => errors.push(text) }), 1);
  assert.equal(disconnected, true); assert.equal(output.length, 0);
  assert.doesNotMatch(errors.join(""), /secret|private-host|postgres/);
  assert.equal(JSON.parse(errors[0]).code, "SOURCE_REPORT_READ_FAILED");
});

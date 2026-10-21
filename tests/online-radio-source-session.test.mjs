import assert from "node:assert/strict";
import test from "node:test";
import { assertNoOpenSourceSession, closeSourceSession, openSourceSession, sourceSessionAuditIds,
  SOURCE_SESSION_OPEN_ACTION, SOURCE_SESSION_CLOSED_ACTION } from "../lib/online-radio-source-session.mjs";

const identity = { organisationId: "org-1", stationId: "station-1", destinationId: "destination-1", sessionId: "runtime-1" };
const scope = { organisationId: identity.organisationId, stationId: identity.stationId, destinationId: identity.destinationId };
const confirmed = { stopConfirmed: true, ledgerDrained: true };
const rejectsCode = (promise, code) => assert.rejects(promise, { code });
function fixture() {
  const rows = new Map(), reads = [], writes = [], queries = [];
  const db = { auditLog: {
    async findUnique(query) { reads.push(structuredClone(query)); return structuredClone(rows.get(query.where.id) ?? null); },
    async upsert(query) {
      writes.push(structuredClone(query));
      if (!rows.has(query.where.id)) rows.set(query.where.id, { ...structuredClone(query.create), createdAt: new Date("2026-10-21T12:00:00Z") });
      return structuredClone(rows.get(query.where.id));
    }
  }, async $queryRaw(strings, ...values) {
    const sql = strings.join("?"); queries.push({ sql, values });
    const [organisationId, stationId] = values;
    return structuredClone([...rows.values()].filter(row => {
      if (row.action !== SOURCE_SESSION_OPEN_ACTION || row.organisationId !== organisationId || row.entityId !== stationId) return false;
      const d = row.details, closed = rows.get(d.closureAuditId);
      if (!closed) return true;
      const expectedOpen = { ...closed.details, sourceState: "RUN_OPEN", stopConfirmed: false, ledgerDrained: false };
      return closed.action !== SOURCE_SESSION_CLOSED_ACTION || closed.entityType !== "Station" || row.entityType !== "Station" ||
        closed.entityId !== row.entityId || closed.organisationId !== row.organisationId || closed.details.stopConfirmed !== true ||
        closed.details.ledgerDrained !== true || closed.createdAt < row.createdAt || JSON.stringify(d) !== JSON.stringify(expectedOpen);
    }).slice(0, 2));
  } };
  return { db, rows, reads, writes, queries };
}

test("open marker is immutable and idempotent but never listener or royalty confirmation", async () => {
  const f = fixture(), result = await openSourceSession(f.db, identity);
  await openSourceSession(f.db, identity);
  assert.equal(f.rows.size, 1);
  assert.equal(result.sourceState, "RUN_OPEN");
  assert.equal(result.listenerProof, false); assert.equal(result.royaltyConfirmed, false);
  const row = f.rows.get(sourceSessionAuditIds(identity).openId);
  assert.equal(row.details.sourceState, "RUN_OPEN");
  assert.equal(row.details.stopConfirmed, false); assert.equal(row.details.ledgerDrained, false);
  assert.deepEqual(f.writes[0].update, {});
  assert.equal(row.details.evidenceKind, "SOURCE_CONNECTION_LIFECYCLE");
});

test("an opened run independently blocks a fresh source even when no track event exists", async () => {
  const f = fixture();
  assert.equal((await assertNoOpenSourceSession(f.db, scope)).clear, true);
  await openSourceSession(f.db, identity);
  await rejectsCode(assertNoOpenSourceSession(f.db, scope), "SOURCE_SESSION_UNCLOSED");
});

test("close needs both independently confirmed facts and an exact durable open marker", async () => {
  const f = fixture();
  for (const options of [{}, { stopConfirmed: true }, { ledgerDrained: true }, { stopConfirmed: false, ledgerDrained: true },
    { stopConfirmed: true, ledgerDrained: "true" }, { ...confirmed, password: "must-not-enter-log" }]) {
    await rejectsCode(closeSourceSession(f.db, identity, options), "SOURCE_SESSION_CLOSE_NOT_CONFIRMED");
  }
  assert.equal(f.writes.length, 0);
  await rejectsCode(closeSourceSession(f.db, identity, confirmed), "SOURCE_SESSION_OPEN_MISSING");
  await openSourceSession(f.db, identity);
  await closeSourceSession(f.db, identity, confirmed);
  await closeSourceSession(f.db, identity, confirmed);
  assert.equal(f.rows.size, 2);
  assert.equal((await assertNoOpenSourceSession(f.db, scope)).clear, true);
  await rejectsCode(openSourceSession(f.db, identity), "SOURCE_SESSION_ALREADY_CLOSED");
});

test("a different session cannot certify closure and a different destination cannot bypass an open run", async () => {
  const f = fixture(); await openSourceSession(f.db, identity);
  await rejectsCode(closeSourceSession(f.db, { ...identity, sessionId: "runtime-2" }, confirmed), "SOURCE_SESSION_OPEN_MISSING");
  await rejectsCode(assertNoOpenSourceSession(f.db, { ...scope, destinationId: "destination-2" }), "SOURCE_SESSION_SCOPE_MISMATCH");
  assert.equal(f.rows.size, 1);
});

test("strictly matching closed history is excluded before the bounded unclosed search", async () => {
  const f = fixture();
  for (let index = 0; index < 150; index += 1) {
    const run = { ...identity, sessionId: `runtime-${index}` };
    await openSourceSession(f.db, run); await closeSourceSession(f.db, run, confirmed);
  }
  assert.equal((await assertNoOpenSourceSession(f.db, scope)).clear, true);
  await openSourceSession(f.db, { ...identity, sessionId: "older-unclosed-runtime" });
  await rejectsCode(assertNoOpenSourceSession(f.db, scope), "SOURCE_SESSION_UNCLOSED");
  const query = f.queries.at(-1);
  assert.match(query.sql, /NOT EXISTS/);
  assert.match(query.sql, /LIMIT 2/);
  assert.ok(query.sql.indexOf("NOT EXISTS") < query.sql.indexOf("LIMIT 2"));
  assert.deepEqual(query.values, [identity.organisationId, identity.stationId]);
  assert.doesNotMatch(query.sql, /org-1|station-1/);
  assert.match(query.sql, /'stopConfirmed', true, 'ledgerDrained', true/);
  assert.match(query.sql, /o\.details = jsonb_build_object/);
  assert.match(query.sql, /c\.details = jsonb_build_object/);
});

test("malformed open or matching-looking unconfirmed closure fails closed", async () => {
  const f = fixture(); await openSourceSession(f.db, identity); await closeSourceSession(f.db, identity, confirmed);
  const closed = f.rows.get(sourceSessionAuditIds(identity).closedId);
  closed.details.ledgerDrained = false;
  await rejectsCode(assertNoOpenSourceSession(f.db, scope), "SOURCE_SESSION_UNCLOSED");
  const open = f.rows.get(sourceSessionAuditIds(identity).openId);
  open.details.privatePath = "/private/must-not-escape";
  await rejectsCode(assertNoOpenSourceSession(f.db, scope), "SOURCE_SESSION_MARKER_CONFLICT");
  await rejectsCode(closeSourceSession(f.db, identity, confirmed), "SOURCE_SESSION_MARKER_CONFLICT");
});

test("a closure marker older than its open marker cannot certify a later run", async () => {
  const f = fixture(); await openSourceSession(f.db, identity); await closeSourceSession(f.db, identity, confirmed);
  f.rows.get(sourceSessionAuditIds(identity).closedId).createdAt = new Date("2026-10-20T12:00:00Z");
  await rejectsCode(assertNoOpenSourceSession(f.db, scope), "SOURCE_SESSION_UNCLOSED");
  await rejectsCode(closeSourceSession(f.db, identity, confirmed), "SOURCE_SESSION_MARKER_CONFLICT");
});

test("immutable ID collisions and foreign return rows cannot authorize a run", async () => {
  const f = fixture(); await openSourceSession(f.db, identity);
  f.rows.get(sourceSessionAuditIds(identity).openId).organisationId = "other-org";
  await rejectsCode(openSourceSession(f.db, identity), "SOURCE_SESSION_MARKER_CONFLICT");
  await rejectsCode(closeSourceSession(f.db, identity, confirmed), "SOURCE_SESSION_MARKER_CONFLICT");
  const foreign = fixture(); await openSourceSession(foreign.db, identity);
  const row = foreign.rows.get(sourceSessionAuditIds(identity).openId);
  foreign.db.$queryRaw = async () => [{ ...row, entityId: "other-station" }];
  await rejectsCode(assertNoOpenSourceSession(foreign.db, scope), "SOURCE_SESSION_MARKER_CONFLICT");
});

test("write and query failures expose no raw driver or credential messages", async () => {
  const f = fixture(); f.db.auditLog.upsert = async () => { throw new Error("postgres://user:secret@private-database"); };
  await rejectsCode(openSourceSession(f.db, identity), "SOURCE_SESSION_DATABASE_FAILED");
  f.db.$queryRaw = async () => { throw new Error("source password must not escape"); };
  await rejectsCode(assertNoOpenSourceSession(f.db, scope), "SOURCE_SESSION_DATABASE_FAILED");
  assert.equal(f.rows.size, 0);
});

test("an OPEN commit with an unknown response remains durable and blocks restart", async () => {
  const f = fixture(), original = f.db.auditLog.upsert;
  let settle;
  f.db.auditLog.upsert = async query => {
    const row = await original(query);
    return new Promise(resolve => { settle = () => resolve(row); });
  };
  await rejectsCode(openSourceSession(f.db, identity, { timeoutMs: 10 }), "SOURCE_SESSION_DATABASE_TIMEOUT");
  assert.equal(f.rows.size, 1);
  await rejectsCode(assertNoOpenSourceSession(f.db, scope), "SOURCE_SESSION_UNCLOSED");
  settle(); await new Promise(resolve => setImmediate(resolve));
  await rejectsCode(assertNoOpenSourceSession(f.db, scope), "SOURCE_SESSION_UNCLOSED");
});

test("failed closure cannot clear a run, while a late closure is safe only after confirmed stop and drain", async () => {
  const f = fixture(); await openSourceSession(f.db, identity);
  const original = f.db.auditLog.upsert;
  f.db.auditLog.upsert = async () => { throw new Error("database unavailable"); };
  await rejectsCode(closeSourceSession(f.db, identity, confirmed), "SOURCE_SESSION_DATABASE_FAILED");
  await rejectsCode(assertNoOpenSourceSession(f.db, scope), "SOURCE_SESSION_UNCLOSED");
  let settle;
  f.db.auditLog.upsert = async query => { const row = await original(query); return new Promise(resolve => { settle = () => resolve(row); }); };
  await rejectsCode(closeSourceSession(f.db, identity, { ...confirmed, timeoutMs: 10 }), "SOURCE_SESSION_DATABASE_TIMEOUT");
  // Both closure prerequisites were verified before the append was attempted.
  assert.equal((await assertNoOpenSourceSession(f.db, scope)).clear, true);
  settle(); await new Promise(resolve => setImmediate(resolve));
});

test("read timeout, malformed query results, opaque identity and option bounds fail closed", async () => {
  const f = fixture(); f.db.$queryRaw = () => new Promise(() => {});
  await rejectsCode(assertNoOpenSourceSession(f.db, scope, { timeoutMs: 10 }), "SOURCE_SESSION_DATABASE_TIMEOUT");
  f.db.$queryRaw = async () => ({ count: 0 });
  await rejectsCode(assertNoOpenSourceSession(f.db, scope), "SOURCE_SESSION_QUERY_INVALID");
  f.db.$queryRaw = async () => [null];
  await rejectsCode(assertNoOpenSourceSession(f.db, scope), "SOURCE_SESSION_MARKER_CONFLICT");
  for (const extra of [{ sessionId: "a/private/path" }, { destinationId: "https://source:secret@host/stream" }, { credential: "secret" }]) {
    await rejectsCode(openSourceSession(f.db, { ...identity, ...extra }), "SOURCE_SESSION_IDENTITY_INVALID");
  }
  await rejectsCode(openSourceSession(f.db, identity, { timeoutMs: 10001 }), "SOURCE_SESSION_OPTIONS_INVALID");
});

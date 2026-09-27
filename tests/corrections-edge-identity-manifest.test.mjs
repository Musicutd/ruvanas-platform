import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { createEdgeCredential, parseEdgeCredential, hashEdgeCredential,
  edgeCredentialMatches, edgeNodeIsUsable } from "../lib/corrections-edge-identity.mjs";
import { signEdgeManifest, verifyEdgeManifest } from "../lib/corrections-edge-manifest.mjs";

const nodeId = "cm12345678901234567890123";
const secret = "C8 isolated test secret is deliberately longer than thirty two chars";

test("one-use enrolment and machine credentials have distinct formats and hashes", () => {
  const enrolment = createEdgeCredential(nodeId, "enrolment");
  const machine = createEdgeCredential(nodeId);
  assert.deepEqual(parseEdgeCredential(enrolment, "enrolment"), { nodeId });
  assert.equal(parseEdgeCredential(enrolment), null);
  assert.deepEqual(parseEdgeCredential(machine), { nodeId });
  assert.equal(parseEdgeCredential(machine, "enrolment"), null);
  assert.notEqual(enrolment, machine);
  const hash = hashEdgeCredential(machine, secret);
  assert.equal(edgeCredentialMatches(machine, hash, secret), true);
  assert.equal(edgeCredentialMatches(createEdgeCredential(nodeId), hash, secret), false);
  assert.equal(edgeCredentialMatches(machine, hash, "wrong secret longer than 32 chars for test"), false);
});

test("node usability fails closed on revocation, another facility, or no Corrections facility", () => {
  const active = { status: "ACTIVE", enrolledAt: new Date("2026-09-01"), credentialHash: "a".repeat(64),
    organisationId: "orgA", facility: { organisationId: "orgA", status: "ACTIVE", correctionsFacility: {} } };
  assert.equal(edgeNodeIsUsable(active), true);
  assert.equal(edgeNodeIsUsable({ ...active, status: "REVOKED" }), false);
  assert.equal(edgeNodeIsUsable({ ...active, revokedAt: new Date() }), false);
  assert.equal(edgeNodeIsUsable({ ...active, facility: { ...active.facility, organisationId: "orgB" } }), false);
  assert.equal(edgeNodeIsUsable({ ...active, facility: { ...active.facility, correctionsFacility: null } }), false);
});

test("Ed25519 manifest rejects tampering, replay, other facility/node, expiry, unsupported version", () => {
  const pair = generateKeyPairSync("ed25519");
  const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicPem = pair.publicKey.export({ type: "spki", format: "pem" });
  const now = new Date("2026-09-27T12:00:00.000Z");
  const scope = { organisationId: "orgA", facilityId: "facilityA", nodeId };
  const payload = { schema: 1, ...scope, sequence: 1, issuedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(), zones: [], content: [] };
  const envelope = signEdgeManifest(payload, privatePem);
  assert.equal(verifyEdgeManifest(envelope, publicPem, scope, { now }), true);
  assert.equal(verifyEdgeManifest(envelope, publicPem, { ...scope, facilityId: "facilityB" }, { now }), false);
  assert.equal(verifyEdgeManifest(envelope, publicPem, { ...scope, nodeId: "anotherNode" }, { now }), false);
  assert.equal(verifyEdgeManifest(envelope, publicPem, scope, { now, lastSequence: 1 }), false);
  assert.equal(verifyEdgeManifest(envelope, publicPem, scope, { now: new Date("2026-09-29") }), false);
  assert.equal(verifyEdgeManifest({ ...envelope, payload: { ...payload, sequence: 2 } }, publicPem, scope, { now }), false);
  assert.equal(verifyEdgeManifest(signEdgeManifest({ ...payload, schema: 2 }, privatePem), publicPem, scope, { now }), false);
  const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });
  assert.equal(verifyEdgeManifest(envelope, other, scope, { now }), false);
});

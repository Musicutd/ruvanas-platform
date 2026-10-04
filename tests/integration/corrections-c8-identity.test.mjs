import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { verifyEdgeManifest } from "../../lib/corrections-edge-manifest.mjs";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3108";
const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";
const disposableLocalDatabase = process.env.C8_LOCAL_INTEGRATION === "true" &&
  process.env.DATABASE_URL === "postgresql://c8lab@127.0.0.1:5548/ruvanas_c8_migration_clean";
const isolatedIntegration = ciDatabase || disposableLocalDatabase;
const testPrivateKey = createPrivateKey({ key: Buffer.concat([
  Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 7)
]), format: "der", type: "pkcs8" });
const testPublicPem = createPublicKey(testPrivateKey).export({ type: "spki", format: "pem" });

async function api(path, { method = "GET", body, cookie, machine, enrolCredential, noOrigin = false } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(noOrigin ? {} : { origin: baseUrl }),
    ...(body !== undefined ? { "content-type": "application/json" } : {}),
    ...(cookie ? { cookie } : {}), ...((machine || enrolCredential) ? { authorization: `Bearer ${machine || enrolCredential}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

test("C8A facility-bound one-use enrolment, Tier 4 gate, rotation and revocation", {
  skip: !isolatedIntegration ? "Requires the exact disposable C8 lab or CI database." : false
}, async () => {
  if (!isolatedIntegration || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C8 identity integration is restricted to the exact disposable CI or local test database.");
  }
  const db = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const password = `C8-test-${randomUUID()}!`;
  const organisations = [];
  const plans = [];
  const users = [];
  try {
    for (const tier of [3, 4]) {
      const plan = await db.plan.create({ data: { name: `C8 ${tier} ${suffix}`, code: `C8_${tier}_${suffix}`,
        productFamily: "CORRECTIONS", tierNumber: tier, monthlyPriceCents: 49900, storageLimitGb: 10,
        listenerLimit: 100, maxBitrateKbps: 128, correctionsRadioEnabled: true, stationLimit: 4 } });
      plans.push(plan);
      const organisation = await db.organisation.create({ data: { name: `C8 ${tier} ${suffix}`, slug: `c8-${tier}-${suffix}` } });
      organisations.push(organisation);
      await db.subscription.create({ data: { organisationId: organisation.id, planId: plan.id, status: "ACTIVE" } });
    }
    const [tier3, tier4] = organisations;
    await db.correctionsProfile.create({ data: { organisationId: tier4.id, policyConfiguredAt: new Date() } });
    const facilities = [];
    for (const [organisation, label] of [[tier3, "tier3"], [tier4, "A"], [tier4, "B"]]) {
      facilities.push(await db.location.create({ data: { organisationId: organisation.id, name: `C8 ${label}`,
        slug: `c8-${label}-${suffix}`, status: "ACTIVE", countryCode: "MT",
        correctionsFacility: { create: { policyConfiguredAt: new Date() } } } }));
    }
    async function signIn(role, label) {
      const user = await db.user.create({ data: { name: label, email: `c8-${label}-${suffix}@example.invalid`,
        passwordHash: await bcrypt.hash(password, 4), role } });
      users.push(user);
      const login = await api("/api/auth/login", { method: "POST", body: { email: user.email, password } });
      assert.equal(login.status, 200, JSON.stringify(login.body));
      return login.cookie;
    }
    const adminCookie = await signIn("SUPER_ADMIN", "admin");
    const ownerCookie = await signIn("OWNER", "owner");
    const create = (organisationId, facilityId, cookie = adminCookie) => api("/api/admin/corrections/edge", {
      method: "POST", cookie, body: { organisationId, facilityId, name: "Synthetic Edge A" } });
    assert.equal((await create(tier4.id, facilities[1].id, ownerCookie)).status, 403);
    assert.equal((await create(tier3.id, facilities[0].id)).status, 403);
    assert.equal((await create(tier4.id, facilities[0].id)).status, 400);
    const created = await create(tier4.id, facilities[1].id);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.facilityId, facilities[1].id);
    const nodeId = created.body.nodeId;
    assert.equal((await api("/api/corrections/edge/enrol", { method: "POST", noOrigin: true,
      body: { enrolmentCredential: created.body.enrolmentCredential, proofPublicKeyPem: testPublicPem } })).status, 403);
    assert.equal((await api("/api/corrections/edge/enrol", { method: "POST", noOrigin: true,
      enrolCredential: `rvee.${nodeId}.${"A".repeat(43)}`,
      body: { enrolmentCredential: created.body.enrolmentCredential, proofPublicKeyPem: testPublicPem } })).status, 401);
    const enrolled = await api("/api/corrections/edge/enrol", { method: "POST",
      enrolCredential: created.body.enrolmentCredential, noOrigin: true,
      body: { enrolmentCredential: created.body.enrolmentCredential, softwareVersion: "c8-test",
        proofPublicKeyPem: testPublicPem } });
    assert.equal(enrolled.status, 200, JSON.stringify(enrolled.body));
    assert.equal(enrolled.body.facilityId, facilities[1].id);
    assert.equal((await api("/api/corrections/edge/enrol", { method: "POST",
      enrolCredential: created.body.enrolmentCredential, noOrigin: true,
      body: { enrolmentCredential: created.body.enrolmentCredential, proofPublicKeyPem: testPublicPem } })).status, 401);
    const machine = enrolled.body.machineCredential;
    const heartbeat = () => api("/api/corrections/edge/heartbeat", { method: "POST", machine,
      body: { softwareVersion: "c8-test", storageHealth: "HEALTHY", syncStatus: "IDLE",
        pendingProofCount: 0, cachedContentCount: 0 } });
    assert.equal((await heartbeat()).status, 200);
    const manifest = await api("/api/corrections/edge/manifest", { machine });
    assert.equal(manifest.status, 200, JSON.stringify(manifest.body));
    assert.equal(verifyEdgeManifest(manifest.body, testPublicPem, {
      nodeId, organisationId: tier4.id, facilityId: facilities[1].id
    }), true);
    assert.equal(manifest.body.payload.content.length, 0);
    const receipt = await api("/api/corrections/edge/sync", { method: "POST", machine,
      body: { sequence: manifest.body.payload.sequence, version: manifest.body.version, downloaded: 0, reused: 0 } });
    assert.equal(receipt.status, 200, JSON.stringify(receipt.body));
    assert.notEqual((await db.correctionsEdgeNode.findUnique({ where: { id: nodeId } })).lastSuccessfulSyncAt, null);
    assert.equal((await api("/api/corrections/edge/sync", { method: "POST", machine,
      body: { sequence: manifest.body.payload.sequence, version: "0".repeat(64), downloaded: 0, reused: 0 } })).status, 409);
    assert.equal((await api("/api/corrections/edge/media/arbitrary-id", { machine })).status, 404);
    assert.equal((await api("/api/corrections/edge/manifest", { machine: `${machine}altered` })).status, 401);
    const list = await api("/api/admin/corrections/edge", { cookie: adminCookie });
    assert.equal(list.status, 200);
    const listed = list.body.nodes.find((node) => node.id === nodeId);
    assert.equal(listed?.facilityId, facilities[1].id);
    assert.equal(listed?.effectiveStatus, "ONLINE");
    assert.equal(JSON.stringify(listed).includes(machine), false);
    const adminPage = await fetch(`${baseUrl}/admin/corrections/edge`, { headers: { cookie: adminCookie } });
    assert.equal(adminPage.status, 200);
    assert.match(await adminPage.text(), /Secure Edge control centre/);
    const rotate = await api(`/api/admin/corrections/edge/${nodeId}`, { method: "POST", cookie: adminCookie,
      body: { action: "ROTATE_CREDENTIAL" } });
    assert.equal(rotate.status, 200, JSON.stringify(rotate.body));
    assert.equal(rotate.body.keyVersion, 2);
    assert.equal((await heartbeat()).status, 401);
    assert.equal((await api("/api/corrections/edge/heartbeat", { method: "POST", machine: rotate.body.machineCredential,
      body: { softwareVersion: "c8-test", storageHealth: "HEALTHY", syncStatus: "IDLE",
        pendingProofCount: 0, cachedContentCount: 0 } })).status, 200);
    const revoked = await api(`/api/admin/corrections/edge/${nodeId}`, { method: "POST", cookie: adminCookie,
      body: { action: "REVOKE" } });
    assert.equal(revoked.status, 200);
    assert.equal((await api("/api/corrections/edge/heartbeat", { method: "POST", machine: rotate.body.machineCredential,
      body: { softwareVersion: "c8-test", storageHealth: "HEALTHY", syncStatus: "IDLE",
        pendingProofCount: 0, cachedContentCount: 0 } })).status, 401);
    assert.equal((await db.correctionsEdgeNode.findUnique({ where: { id: nodeId } })).credentialHash, null);
  } finally {
    for (const organisation of organisations) {
      await db.correctionsEdgeNode.deleteMany({ where: { organisationId: organisation.id } });
      await db.location.deleteMany({ where: { organisationId: organisation.id } });
      await db.subscription.deleteMany({ where: { organisationId: organisation.id } });
      await db.organisation.delete({ where: { id: organisation.id } });
    }
    for (const user of users) await db.user.delete({ where: { id: user.id } });
    for (const plan of plans) await db.plan.delete({ where: { id: plan.id } });
    await db.$disconnect();
  }
});

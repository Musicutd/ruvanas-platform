import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { deleteTrialOrganisation } from "../../lib/trial-organisation-deletion.mjs";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

async function api(path, cookie, body) {
  return fetch(`${baseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: { origin: baseUrl, cookie, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "manual"
  });
}

test("Edge-only cloud evidence is inventoried and blocks generic retention and trial deletion", {
  skip: ciDatabase ? false : "Requires the exact disposable CI PostgreSQL database."
}, async () => {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("An isolated CI session secret is required.");
  }
  const db = new PrismaClient();
  const suffix = randomUUID();
  const password = `CI-only-${randomUUID()}!`;
  let actor, protectedOrg, otherOrg, location, node, manifest, proof;
  try {
    actor = await db.user.create({ data: {
      email: `c8-c9-edge-inventory-${suffix}@example.invalid`,
      passwordHash: await bcrypt.hash(password, 4), role: "SUPER_ADMIN"
    } });
    protectedOrg = await db.organisation.create({ data: {
      name: "Fictional Edge-only organisation", slug: `c8-c9-edge-${suffix}`
    } });
    otherOrg = await db.organisation.create({ data: {
      name: "Fictional unrelated organisation", slug: `c8-c9-other-${suffix}`
    } });
    // A plain location and no Corrections audit, entitlement or shared proof
    // make the Edge relationship the only evidence that can veto deletion.
    location = await db.location.create({ data: {
      organisationId: protectedOrg.id, name: "Fictional plain location",
      slug: `c8-c9-location-${suffix}`
    } });
    node = await db.correctionsEdgeNode.create({ data: {
      organisationId: protectedOrg.id, facilityId: location.id, name: "Fictional Edge node"
    } });
    manifest = await db.correctionsEdgeManifest.create({ data: {
      nodeId: node.id, sequence: 1, version: "a".repeat(64),
      payload: { marker: "fictional-private-content" }, signature: "CI-only-signature",
      validFrom: new Date("2026-10-01T00:00:00.000Z"),
      validUntil: new Date("2026-10-31T00:00:00.000Z")
    } });
    proof = await db.correctionsEdgeProofEvent.create({ data: {
      nodeId: node.id, sequence: 1, eventId: `c8-c9-${suffix}`,
      eventHash: "b".repeat(64), signature: "CI-only-signature",
      payload: { marker: "fictional-private-content" },
      occurredAt: new Date("2026-10-02T00:00:00.000Z")
    } });

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({ email: actor.email, password }), redirect: "manual"
    });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    for (const [organisation, expected] of [[protectedOrg, 1], [otherOrg, 0]]) {
      const response = await api(
        `/api/admin/corrections/privacy-inventory?organisationId=${organisation.id}`, cookie);
      assert.equal(response.status, 200, await response.clone().text());
      assert.match(response.headers.get("cache-control") || "", /no-store/);
      const body = await response.json();
      assert.equal(body.organisationId, organisation.id);
      assert.equal(Object.keys(body.counts).length, 26);
      for (const key of ["edgeNodes", "edgeSignedManifests", "edgeRawProofEvents"]) {
        assert.equal(body.counts[key], expected, `${key} must be tenant-scoped`);
      }
      assert.ok(Object.entries(body.counts).every(([key, value]) =>
        key.startsWith("edge") ? value === expected : value === 0));
      assert.equal(JSON.stringify(body).includes("fictional-private-content"), false);
    }

    const preview = await api("/api/admin/compliance", cookie, {
      action: "PREVIEW_RETENTION", organisationId: protectedOrg.id
    });
    assert.equal(preview.status, 409, await preview.clone().text());
    assert.match((await preview.json()).error, /Ruvanas Inside access or evidence/);
    assert.equal(await db.retentionJob.count({ where: { organisationId: protectedOrg.id } }), 0);

    await assert.rejects(deleteTrialOrganisation(db, {
      actor, organisationId: protectedOrg.id,
      confirmation: `DELETE ${protectedOrg.slug}`
    }), (error) => error.code === "CORRECTIONS_EVIDENCE_PRESENT");
    assert.ok(await db.organisation.findUnique({ where: { id: protectedOrg.id } }));
    assert.ok(await db.correctionsEdgeNode.findUnique({ where: { id: node.id } }));
    assert.ok(await db.correctionsEdgeManifest.findUnique({ where: { id: manifest.id } }));
    assert.ok(await db.correctionsEdgeProofEvent.findUnique({ where: { id: proof.id } }));
    assert.equal(await db.auditLog.count({ where: {
      action: "TRIAL_ORGANISATION_DELETED", entityId: protectedOrg.id
    } }), 0);
  } finally {
    try {
      if (proof) await db.correctionsEdgeProofEvent.deleteMany({ where: { id: proof.id } });
      if (manifest) await db.correctionsEdgeManifest.deleteMany({ where: { id: manifest.id } });
      if (node) await db.correctionsEdgeNode.deleteMany({ where: { id: node.id } });
      if (location) await db.location.deleteMany({ where: { id: location.id } });
      if (protectedOrg) await db.retentionJob.deleteMany({ where: { organisationId: protectedOrg.id } });
      if (otherOrg) await db.retentionJob.deleteMany({ where: { organisationId: otherOrg.id } });
      if (protectedOrg) await db.auditLog.deleteMany({ where: { organisationId: protectedOrg.id } });
      if (otherOrg) await db.auditLog.deleteMany({ where: { organisationId: otherOrg.id } });
      if (protectedOrg) await db.organisation.deleteMany({ where: { id: protectedOrg.id } });
      if (otherOrg) await db.organisation.deleteMany({ where: { id: otherOrg.id } });
      if (actor) await db.user.deleteMany({ where: { id: actor.id } });
    } finally {
      await db.$disconnect();
    }
  }
});

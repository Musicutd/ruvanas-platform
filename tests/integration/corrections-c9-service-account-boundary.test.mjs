import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { generateServiceApiKey } from "../../lib/enterprise-security.mjs";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

async function api(path, key, body) {
  return fetch(`${baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin: baseUrl,
      authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
}

test("generic service-account scopes cannot list or import metrics for private Corrections facilities", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 service-account integration runs only against the exact disposable CI database.");
  }

  const db = new PrismaClient();
  const suffix = randomUUID();
  const organisationIds = [];
  let userId;
  try {
    const organisation = await db.organisation.create({
      data: { name: `Fictional C9 boundary ${suffix}`, slug: `c9-boundary-${suffix}` }
    });
    organisationIds.push(organisation.id);
    const otherOrganisation = await db.organisation.create({
      data: { name: `Fictional C9 other ${suffix}`, slug: `c9-other-${suffix}` }
    });
    organisationIds.push(otherOrganisation.id);
    const user = await db.user.create({
      data: { email: `c9-boundary-${suffix}@example.invalid`, passwordHash: "CI-only-no-login" }
    });
    userId = user.id;

    const normalLocation = await db.location.create({
      data: { organisationId: organisation.id, name: "Fictional normal shop", slug: `c9-shop-${suffix}` }
    });
    const privateFacility = await db.location.create({
      data: {
        organisationId: organisation.id,
        name: "Fictional private facility",
        slug: `c9-private-${suffix}`,
        correctionsFacility: { create: {} }
      }
    });
    const foreignLocation = await db.location.create({
      data: { organisationId: otherOrganisation.id, name: "Fictional other shop", slug: `c9-foreign-${suffix}` }
    });
    const key = generateServiceApiKey(process.env.SESSION_SECRET);
    await db.serviceAccount.create({
      data: {
        organisationId: organisation.id,
        createdByUserId: user.id,
        name: `Fictional generic integration ${suffix}`,
        scopes: ["locations:read", "metrics:write"],
        apiKeys: { create: { name: "CI-only key", prefix: key.prefix, tokenHash: key.tokenHash } }
      }
    });
    const connection = await db.integrationConnection.create({
      data: {
        organisationId: organisation.id,
        createdByUserId: user.id,
        name: `Fictional POS ${suffix}`,
        kind: "POS_METRICS",
        providerKey: "INTEGRATION_POS_V1"
      }
    });

    const locations = await api("/api/v1/locations?limit=100", key.rawKey);
    assert.equal(locations.status, 200, await locations.clone().text());
    const listed = (await locations.json()).data;
    assert.ok(listed.some(({ id }) => id === normalLocation.id));
    assert.ok(!listed.some(({ id }) => id === privateFacility.id));
    assert.ok(!listed.some(({ id }) => id === foreignLocation.id));

    const now = new Date();
    const metric = (locationId, externalId) => ({
      externalId,
      locationId,
      metricType: "POS_TRANSACTION_COUNT",
      value: 3,
      unit: "COUNT",
      windowStartedAt: new Date(now.getTime() - 60_000).toISOString(),
      windowEndedAt: now.toISOString(),
      sourceTimestamp: now.toISOString()
    });
    const importMetrics = (metrics) => api("/api/v1/integration-metrics", key.rawKey, {
      connectionId: connection.id,
      metrics
    });

    const privateOnly = await importMetrics([metric(privateFacility.id, `private-${suffix}`)]);
    assert.equal(privateOnly.status, 403, await privateOnly.clone().text());
    const mixed = await importMetrics([
      metric(normalLocation.id, `mixed-normal-${suffix}`),
      metric(privateFacility.id, `mixed-private-${suffix}`)
    ]);
    assert.equal(mixed.status, 403, await mixed.clone().text());
    const foreign = await importMetrics([metric(foreignLocation.id, `foreign-${suffix}`)]);
    assert.equal(foreign.status, 403, await foreign.clone().text());
    assert.equal(await db.integrationMetricSummary.count({ where: { connectionId: connection.id } }), 0);

    const normal = await importMetrics([metric(normalLocation.id, `normal-${suffix}`)]);
    assert.equal(normal.status, 201, await normal.clone().text());
    assert.equal(await db.integrationMetricSummary.count({ where: { connectionId: connection.id, locationId: normalLocation.id } }), 1);
    assert.equal(await db.integrationMetricSummary.count({ where: { connectionId: connection.id, locationId: privateFacility.id } }), 0);
  } finally {
    try {
      if (organisationIds.length) await db.organisation.deleteMany({ where: { id: { in: organisationIds } } });
      if (userId) await db.user.delete({ where: { id: userId } });
    } finally {
      await db.$disconnect();
    }
  }
});

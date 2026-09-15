import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { encryptDistributorCredentials, requestDistributorAccessToken, safeDistributorConnection } from "../lib/music-distributor-service.js";

test("OAuth client credentials are encrypted, sent only to the token endpoint, and never serialised", async () => {
  const previous = process.env.SECRET_ENCRYPTION_KEY;
  process.env.SECRET_ENCRYPTION_KEY = "11".repeat(32);
  try {
    const encrypted = encryptDistributorCredentials({ clientId: "client-id", clientSecret: "client-secret-value" });
    assert.doesNotMatch(encrypted, /client-id|client-secret-value/);
    const connection = {
      id: "connection-1",
      tokenUrl: "https://identity.example.test/oauth/token",
      clientCredentialsEncrypted: encrypted,
      oauthScopes: ["catalogue.read"],
      syncLeaseOwner: "worker-secret"
    };
    const calls = [];
    const result = await requestDistributorAccessToken(connection, { fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ access_token: "short-lived-token", token_type: "Bearer", expires_in: 300 }), { status: 200, headers: { "content-type": "application/json" } });
    } });
    assert.deepEqual(result, { accessToken: "short-lived-token", expiresIn: 300 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, "POST");
    assert.match(calls[0].options.headers.authorization, /^Basic /);
    assert.equal(new URLSearchParams(calls[0].options.body).get("grant_type"), "client_credentials");
    assert.equal(new URLSearchParams(calls[0].options.body).get("scope"), "catalogue.read");
    const safe = safeDistributorConnection(connection);
    assert.equal(safe.credentialStored, true);
    assert.equal(Object.hasOwn(safe, "clientCredentialsEncrypted"), false);
    assert.equal(Object.hasOwn(safe, "syncLeaseOwner"), false);
  } finally {
    if (previous === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
    else process.env.SECRET_ENCRYPTION_KEY = previous;
  }
});

test("the migration, Super Admin console, worker, and provider contract stay wired together", async () => {
  const [schema, migration, navigation, page, worker, service, docs] = await Promise.all([
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261118000000_music_distributor_integration/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/user-experience-navigation.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/music-distributors/page.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/operations-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/music-distributor-service.js", import.meta.url), "utf8"),
    readFile(new URL("../docs/music-distributor-integration.md", import.meta.url), "utf8")
  ]);
  assert.match(schema, /model MusicDistributorConnection/);
  assert.match(schema, /model MusicDistributorUsageDelivery[\s\S]*payload\s+Json/);
  assert.match(migration, /CREATE TABLE "MusicDistributorTrack"/);
  assert.match(migration, /"payload" JSONB NOT NULL/);
  assert.match(navigation, /\/admin\/music-distributors/);
  assert.match(page, /OAuth 2\.0 client credentials/);
  assert.match(worker, /processDueMusicDistributorSyncs/);
  assert.match(worker, /processDueMusicDistributorUsageDeliveries/);
  assert.match(service, /MUSIC_DISTRIBUTOR_SYNC_FAILED/);
  assert.match(service, /MUSIC_DISTRIBUTOR_USAGE_DELIVERED/);
  assert.match(docs, /provider-specific production transport remains gated/i);
});

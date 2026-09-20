import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

function isolatedHttpReady() {
  try {
    const database = new URL(process.env.DATABASE_URL);
    const app = new URL(process.env.INTEGRATION_BASE_URL);
    return process.env.RUN_DATABASE_TESTS === "1" && process.env.RUN_STREAM_POOL_HTTP_TESTS === "1" &&
      database.hostname === "127.0.0.1" && database.port === "55432" &&
      database.pathname === "/ruvanas_disposable_acceptance" &&
      app.origin === "http://127.0.0.1:3100" &&
      /^[a-f\d]{64}$/i.test(process.env.SECRET_ENCRYPTION_KEY || "") &&
      (process.env.SESSION_SECRET || "").length >= 32;
  } catch {
    return false;
  }
}

test("Super Admin Streamerr intake is role-gated and secret-free over local HTTP", {
  skip: isolatedHttpReady() ? false : "Requires the explicit disposable database and loopback-only local app"
}, async () => {
  const db = new PrismaClient();
  const suffix = randomUUID().replaceAll("-", "");
  const baseUrl = process.env.INTEGRATION_BASE_URL;
  const account = `http_test_${suffix}`;
  const sourcePassword = `http-local-only-${suffix}`;
  const userIds = [];

  async function request(path, { method = "GET", cookie, body } = {}) {
    const headers = { origin: baseUrl };
    if (cookie) headers.cookie = cookie;
    if (body) headers["content-type"] = "application/json";
    return fetch(`${baseUrl}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
      redirect: "manual"
    });
  }

  try {
    const password = "local-http-test-password";
    const passwordHash = await bcrypt.hash(password, 4);
    const admin = await db.user.create({ data: {
      email: `stream-admin-${suffix}@example.invalid`, passwordHash, role: "SUPER_ADMIN"
    }, select: { id: true, email: true } });
    const owner = await db.user.create({ data: {
      email: `stream-owner-${suffix}@example.invalid`, passwordHash, role: "OWNER"
    }, select: { id: true, email: true } });
    userIds.push(admin.id, owner.id);

    const login = async (email) => {
      const response = await request("/api/auth/login", { method: "POST", body: { email, password } });
      assert.equal(response.status, 200, await response.clone().text());
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie?.startsWith("ruvanas_session="));
      return cookie;
    };
    const adminCookie = await login(admin.email);
    const ownerCookie = await login(owner.email);

    const unauthenticated = await request("/api/admin/preprovisioned-radio-streams");
    assert.equal(unauthenticated.status, 401);
    const forbidden = await request("/api/admin/preprovisioned-radio-streams", { cookie: ownerCookie });
    assert.equal(forbidden.status, 403);

    const page = await request("/admin/radio-stream-pool", { cookie: adminCookie });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Create the stream manually/);

    const input = {
      centovaUsername: account,
      streamUrl: `https://http-${suffix}.example.test/stream`,
      serverHost: `source-${suffix}.example.test`,
      serverPort: 8198, sourcePort: 8198,
      sourcePassword, sourceUsername: "",
      listenerLimit: 10, maxBitrateKbps: 128
    };
    const deniedCreate = await request("/api/admin/preprovisioned-radio-streams", { method: "POST", cookie: ownerCookie, body: input });
    assert.equal(deniedCreate.status, 403);

    const created = await request("/api/admin/preprovisioned-radio-streams", { method: "POST", cookie: adminCookie, body: input });
    assert.equal(created.status, 201, await created.clone().text());
    const createdText = await created.text();
    assert.doesNotMatch(createdText, new RegExp(sourcePassword));
    assert.doesNotMatch(createdText, /sourcePasswordEncrypted/);
    assert.equal(JSON.parse(createdText).slot.status, "QUARANTINED");

    const inventory = await request("/api/admin/preprovisioned-radio-streams", { cookie: adminCookie });
    assert.equal(inventory.status, 200);
    const inventoryText = await inventory.text();
    assert.match(inventoryText, new RegExp(account));
    assert.doesNotMatch(inventoryText, new RegExp(sourcePassword));
    assert.doesNotMatch(inventoryText, /sourcePasswordEncrypted/);

    const duplicate = await request("/api/admin/preprovisioned-radio-streams", { method: "POST", cookie: adminCookie, body: input });
    assert.equal(duplicate.status, 409);
  } finally {
    const slot = await db.preprovisionedRadioStream.findUnique({ where: { centovaUsername: account }, select: { id: true } });
    if (slot) {
      await db.auditLog.deleteMany({ where: { entityId: slot.id, action: "ONLINE_RADIO_STREAM_SLOT_REGISTERED" } });
      await db.preprovisionedRadioStream.delete({ where: { id: slot.id } });
    }
    if (userIds.length) {
      await db.session.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await db.$disconnect();
  }
});

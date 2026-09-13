import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SELF_SERVICE_REGISTRATION_ENABLED,
  SELF_SERVICE_REGISTRATION_MESSAGE,
  isInternalRegistrationTestRequest
} from "../lib/registration-availability.mjs";

test("paid and trial self-service registration is disabled until payments are ready", async () => {
  const [route, page, homepage, login, publicGuide] = await Promise.all([
    readFile(new URL("../app/api/auth/register/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/register/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/how-it-works/page.js", import.meta.url), "utf8")
  ]);

  assert.equal(SELF_SERVICE_REGISTRATION_ENABLED, false);
  const internalRequest = { headers: { get: () => "a".repeat(32) } };
  const safeTestEnvironment = {
    RUN_DATABASE_TESTS: "1",
    INTERNAL_REGISTRATION_TEST_KEY: "a".repeat(32),
    INTEGRATION_BASE_URL: "http://127.0.0.1:3100",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/ruvanas"
  };
  assert.equal(isInternalRegistrationTestRequest(internalRequest, safeTestEnvironment), true);
  assert.equal(isInternalRegistrationTestRequest(internalRequest, { ...safeTestEnvironment, DATABASE_URL: "postgresql://db.example/ruvanas" }), false);
  assert.equal(isInternalRegistrationTestRequest({ headers: { get: () => "wrong" } }, safeTestEnvironment), false);
  assert.match(SELF_SERVICE_REGISTRATION_MESSAGE, /payment setup/i);
  assert.match(route, /!SELF_SERVICE_REGISTRATION_ENABLED && !isInternalRegistrationTestRequest\(request\)/);
  assert.match(route, /freeAccessRegistrationRoute: "\/register\/free-access"/);
  assert.match(route, /status: 403/);
  assert.match(page, /Plan registration is temporarily paused/);
  assert.match(page, /All paid and trial tiers remain unavailable/);
  assert.match(page, /\/register\/free-access/);
  assert.match(homepage, /priceCtaDisabled/);
  assert.match(homepage, /Registration paused/);
  assert.match(homepage, /Create account with code/);
  assert.doesNotMatch(login, /href="\/register"/);
  assert.match(login, /href="\/register\/free-access"/);
  assert.match(publicGuide, /href="\/register\/free-access"/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SELF_SERVICE_REGISTRATION_ENABLED,
  SELF_SERVICE_REGISTRATION_MESSAGE
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
  assert.match(SELF_SERVICE_REGISTRATION_MESSAGE, /payment setup/i);
  assert.match(route, /if \(!SELF_SERVICE_REGISTRATION_ENABLED\)/);
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


import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("browser logout destroys the session and returns the user to login", async () => {
  const route = await readFile(new URL("../app/api/auth/logout/route.js", import.meta.url), "utf8");

  assert.match(route, /await destroySession\(\)/);
  assert.match(route, /status: 303/);
  assert.match(route, /location: "\/login"/);
  assert.doesNotMatch(route, /request\.url/);
  assert.doesNotMatch(route, /NextResponse\.json\(\{ success: true \}\)/);
});

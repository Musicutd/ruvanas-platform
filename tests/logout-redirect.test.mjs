import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("browser logout destroys the session and returns the user to login", async () => {
  const route = await readFile(new URL("../app/api/auth/logout/route.js", import.meta.url), "utf8");

  assert.match(route, /await destroySession\(\)/);
  assert.match(route, /NextResponse\.redirect\(new URL\("\/login", request\.url\), 303\)/);
  assert.doesNotMatch(route, /NextResponse\.json\(\{ success: true \}\)/);
});

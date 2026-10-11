import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const loginPage = await readFile(new URL("../app/preview-login/route.js", import.meta.url), "utf8");
const loginApi = await readFile(new URL("../app/api/auth/login/route.js", import.meta.url), "utf8");
const health = await readFile(new URL("../app/api/private-preview/health/route.js", import.meta.url), "utf8");

test("preview sign-in is a no-JavaScript native form with empty credential fields", () => {
  assert.match(loginPage, /<form method="post" action="\/api\/auth\/login"/);
  assert.match(loginPage, /name="email" type="email" autocomplete="username"/);
  assert.match(loginPage, /name="password" type="password" autocomplete="current-password"/);
  assert.doesNotMatch(loginPage, /<script|_next\/|<link|<img|value="[^\"]+"/i);
  assert.match(loginPage, /export function GET\(request\)/);
  assert.match(loginPage, /export function HEAD\(request\)/);
  assert.match(loginPage, /if \(!policy\.enabled\) return new Response\(null, \{ status: 404/);
  assert.match(loginPage, /"cache-control": "no-store/);
  assert.match(loginPage, /"x-robots-tag": "noindex, nofollow, noarchive"/);
  assert.match(loginPage, /frame-ancestors 'none'; base-uri 'none'/);
  assert.match(loginPage, /form-action 'self'/);
});

test("private-preview health fails closed unless policy is valid and enabled", () => {
  assert.match(health, /readPrivatePreviewPolicy\(\)/);
  assert.match(health, /if \(!policy\.enabled\) return 404/);
  assert.match(health, /policy\.valid \? 200 : 503/);
  assert.match(health, /status === 200 \? "OK" : null/);
  assert.doesNotMatch(health, /database|session|user|email/i);
});

test("preview login bounds form input and applies allowlist before session creation", () => {
  assert.match(loginApi, /MAX_PREVIEW_FORM_BYTES = 16 \* 1024/);
  assert.match(loginApi, /bytes > MAX_PREVIEW_FORM_BYTES/);
  assert.match(loginApi, /status: 303/);
  assert.match(loginApi, /location: `\/preview-login\?error=\$\{code\}`/);
  assert.match(loginApi, /location: safeRelativeLanding\(recommendedDashboardRoute\)/);
  assert.ok(loginApi.indexOf("isPrivatePreviewUserAllowed(user, previewPolicy)") > loginApi.indexOf("bcrypt.compare"));
  assert.ok(loginApi.indexOf("isPrivatePreviewUserAllowed(user, previewPolicy)") < loginApi.indexOf("await createSession("));
  assert.match(loginApi, /if \(previewEnabled && !previewPolicy\.valid\)/);
  assert.match(loginApi, /status: 503/);
});

test("ordinary JSON login response and existing landing decision remain present", () => {
  assert.match(loginApi, /const body = previewForm \? await readPreviewForm\(request\) : await request\.json\(\)/);
  assert.match(loginApi, /const recommendedDashboardRoute = loginLandingRoute\(/);
  assert.match(loginApi, /return NextResponse\.json\(\{\s*success: true,\s*recommendedDashboardRoute,/);
  assert.match(loginApi, /user: \{\s*id: user\.id,\s*name: user\.name,\s*email: user\.email,\s*role: user\.role/);
});

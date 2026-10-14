import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = async (path) => readFile(new URL(path, import.meta.url), "utf8");
const loginPage = await source("../app/preview-login/route.js");
const passwordApi = await source("../app/api/auth/login/route.js");
const codeApi = await source("../app/api/auth/preview-code/route.js");
const middleware = await source("../middleware.js");
const ownerPage = await source("../app/admin/private-preview/page.js");
const adminLayout = await source("../app/admin/layout.js");
const ownerControls = await source("../app/admin/private-preview/CodeControls.js");
const ownerApi = await source("../app/api/admin/private-preview/codes/route.js");
const health = await source("../app/api/private-preview/health/route.js");

test("public preview entry is a raw no-JavaScript one-use-code form", () => {
  assert.match(loginPage, /<form method="post" action="\/api\/auth\/preview-code"/);
  assert.match(loginPage, /name="code" type="password" autocomplete="one-time-code" maxlength="52"/);
  assert.doesNotMatch(loginPage, /name="email"|name="password"|<script|_next\/|<link|<img|value="[^\"]+"/i);
  assert.match(loginPage, /Object\.hasOwn\(ERROR_MESSAGES, errorCode\)/);
  assert.match(loginPage, /if \(!policy\.enabled\) return new Response\(null, \{ status: 404/);
  assert.match(loginPage, /"cache-control": "no-store/);
  assert.match(loginPage, /"x-robots-tag": "noindex, nofollow, noarchive"/);
  assert.match(loginPage, /frame-ancestors 'none'; base-uri 'none'/);
  assert.match(loginPage, /form-action 'self'/);
});

test("native code form uses same-origin referrer policy without relaxing POST origin gates", () => {
  assert.match(loginPage, /"referrer-policy": "same-origin"/);
  assert.doesNotMatch(loginPage, /"referrer-policy": "no-referrer"/);
  assert.match(middleware, /const origin = request\.headers\.get\("origin"\)/);
  assert.match(middleware, /if \(!origin \|\| !allowedOrigins\(request\)\.has\(origin\)\)/);
  assert.match(middleware, /This request did not originate from an approved Ruvanas site\./);
  assert.match(codeApi, /request\.headers\.get\("origin"\) !== policy\.previewOrigin/);
  assert.match(codeApi, /return json\(\{ error: "Request not permitted\." \}, 403\)/);
});

test("password login is closed in preview mode without changing ordinary JSON login", () => {
  assert.ok(passwordApi.indexOf("if (previewPolicy.enabled)") < passwordApi.indexOf("await request.json()"));
  assert.match(passwordApi, /Password sign-in is unavailable for this preview/);
  assert.match(passwordApi, /status: previewPolicy.valid \? 403 : 503/);
  assert.match(passwordApi, /const body = await request\.json\(\)/);
  assert.match(passwordApi, /await bcrypt\.compare\(password, user\.passwordHash\)/);
  assert.match(passwordApi, /await createSession\(user\.id, membership\?\.organisationId \|\| null\)/);
  assert.match(passwordApi, /return NextResponse\.json\(\{\s*success: true,\s*recommendedDashboardRoute,/);
});

test("one-use-code redemption is bounded, rate-limited and commits before cookie write", () => {
  assert.match(codeApi, /MAX_BODY_BYTES = 16 \* 1024/);
  assert.match(codeApi, /bytes > MAX_BODY_BYTES/);
  assert.match(codeApi, /request\.headers\.get\("origin"\) !== policy\.previewOrigin/);
  assert.ok(codeApi.indexOf("await consumeRateLimit(") < codeApi.indexOf("await readCode(request, form)"));
  assert.ok(codeApi.indexOf("await readCode(request, form)") < codeApi.indexOf("await redeemPrivatePreviewCode("));
  assert.ok(codeApi.indexOf("await redeemPrivatePreviewCode(") < codeApi.indexOf("await setSessionCookie("));
  assert.match(codeApi, /location: `\/preview-login\?error=\$\{error\}`/);
  assert.match(codeApi, /privatePreviewDashboardRoute\(redeemed\.user, policy\)/);
  assert.ok(codeApi.indexOf("privatePreviewDashboardRoute(redeemed.user, policy)") < codeApi.indexOf("await setSessionCookie("));
  assert.match(codeApi, /return json\(\{ success: true, recommendedDashboardRoute \}, 200\)/);
  assert.doesNotMatch(codeApi, /console\.|securityLog\([^\n]*code[,:]/i);
});

test("an existing valid preview session skips both code-entry URLs for a fixed role dashboard", () => {
  assert.match(middleware, /const loginEntry = \(request\.method === "GET" \|\| request\.method === "HEAD"\)/);
  assert.match(middleware, /request\.nextUrl\.pathname === "\/login" \|\| request\.nextUrl\.pathname === "\/preview-login"/);
  assert.ok(middleware.indexOf("session = await previewSessionFromRequest(request)") <
    middleware.indexOf("NextResponse.rewrite(new URL(\"/preview-login\""));
  assert.match(middleware, /const destination = privatePreviewSessionLanding\(session, preview\)/);
  assert.match(middleware, /NextResponse\.redirect\(new URL\(destination, preview\.previewOrigin\)\)/);
  assert.match(middleware, /NextResponse\.rewrite\(new URL\("\/preview-login", request\.url\)/);
  assert.doesNotMatch(middleware, /NextResponse\.redirect\(new URL\(destination, request\.url\)/);
  assert.match(middleware, /else if \(!destination\) \{\s*return previewDenied\(request, preview, requestId\)/);
  assert.doesNotMatch(middleware, /searchParams\.get\(["'](?:next|returnTo|redirect)/);
});

test("owner controls require a code session and designated owner, never create accounts", () => {
  assert.match(ownerPage, /session\?\.authMethod !== "PREVIEW_CODE"/);
  assert.match(ownerPage, /isPrivatePreviewAdmin\(session\.user, policy\)/);
  assert.match(adminLayout, /canManagePreviewCodes = isPrivatePreviewAdmin\(adminUser, readPrivatePreviewPolicy\(\)\)/);
  assert.match(adminLayout, /canManagePreviewCodes \? <Link href="\/admin\/private-preview"/);
  assert.match(ownerApi, /session\?\.authMethod !== "PREVIEW_CODE"/);
  assert.match(ownerApi, /isPrivatePreviewAdmin\(session\.user, policy\)/);
  assert.match(ownerApi, /request\.headers\.get\("origin"\) !== policy\.previewOrigin/);
  assert.match(ownerApi, /action === "issue" && !policy\.allowedEmails\.has\(email\)/);
  assert.match(ownerApi, /prisma\.user\.findUnique\(\{ where: \{ email \}, select: \{ id: true \} \}\)/);
  assert.match(ownerApi, /issuePrivatePreviewCode\(prisma/);
  assert.match(ownerApi, /revokePrivatePreviewCodes\(prisma/);
  assert.match(ownerApi, /"cache-control": "private, no-store"/);
  assert.doesNotMatch(ownerApi, /prisma\.user\.create|sendMail|mailer|localStorage/);
  assert.match(ownerControls, /useState\(null\)/);
  assert.match(ownerControls, /setIssued\(null\)/);
  assert.doesNotMatch(ownerControls, /localStorage|sessionStorage|console\.|sendMail|mailer/);
});

test("private-preview health fails closed unless policy is valid and enabled", () => {
  assert.match(health, /readPrivatePreviewPolicy\(\)/);
  assert.match(health, /if \(!policy\.enabled\) return 404/);
  assert.match(health, /policy\.valid \? 200 : 503/);
  assert.match(health, /status === 200 \? "OK" : null/);
  assert.doesNotMatch(health, /database|session|user|email/i);
});

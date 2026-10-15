import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = async (path) => readFile(new URL(path, import.meta.url), "utf8");
const loginPage = await source("../app/preview-login/route.js");
const passwordApi = await source("../app/api/auth/login/route.js");
const passwordEndpoint = await source("../app/api/auth/preview-password/route.js");
const passwordHandler = await source("../lib/private-preview-password-route.js");
const previewRequest = await source("../lib/private-preview-request.mjs");
const previewPolicy = await source("../lib/private-preview-policy.mjs");
const codeApi = await source("../app/api/auth/preview-code/route.js");
const middleware = await source("../middleware.js");
const ownerPage = await source("../app/admin/private-preview/page.js");
const adminLayout = await source("../app/admin/layout.js");
const ownerControls = await source("../app/admin/private-preview/CodeControls.js");
const ownerApi = await source("../app/api/admin/private-preview/codes/route.js");
const codeService = await source("../lib/private-preview-codes.mjs");
const ownerPasswordApi = await source("../app/api/admin/private-preview/password/route.js");
const testerApi = await source("../app/api/admin/private-preview/testers/route.js");
const health = await source("../app/api/private-preview/health/route.js");

test("public preview entry provides raw no-JavaScript password and temporary-code forms, not registration", () => {
  assert.match(loginPage, /<form method="post" action="\/api\/auth\/preview-password"/);
  assert.match(loginPage, /name="email" type="email" autocomplete="username" maxlength="254"/);
  assert.match(loginPage, /name="password" type="password" autocomplete="current-password" maxlength="72"/);
  assert.match(loginPage, /<form method="post" action="\/api\/auth\/preview-code"/);
  assert.match(loginPage, /name="code" type="password" autocomplete="one-time-code" maxlength="52"/);
  assert.equal(loginPage.match(/<form method="post"/g)?.length, 2);
  assert.match(loginPage, /Registration is closed/);
  assert.match(loginPage, /Temporary tester access code/);
  assert.match(loginPage, /Admin accounts use a password/);
  assert.doesNotMatch(loginPage, /<script|_next\/|<link|<img|value="[^\"]+"|(?:href|action)="[^\"]*(?:register|sign-up|signup)/i);
  assert.match(loginPage, /Object\.hasOwn\(ERROR_MESSAGES, errorCode\)/);
  assert.match(loginPage, /if \(!policy\.enabled\) return new Response\(null, \{ status: 404/);
  assert.match(loginPage, /"cache-control": "no-store/);
  assert.match(loginPage, /"x-robots-tag": "noindex, nofollow, noarchive"/);
  assert.match(loginPage, /frame-ancestors 'none'; base-uri 'none'/);
  assert.match(loginPage, /form-action 'self'/);
});

test("native sign-in forms use same-origin referrer policy without relaxing POST origin gates", () => {
  assert.match(loginPage, /"referrer-policy": "same-origin"/);
  assert.doesNotMatch(loginPage, /"referrer-policy": "no-referrer"/);
  assert.match(middleware, /const origin = request\.headers\.get\("origin"\)/);
  assert.match(middleware, /if \(!origin \|\| !allowedOrigins\(request, preview\)\.has\(origin\)\)/);
  assert.match(middleware, /This request did not originate from an approved Ruvanas site\./);
  assert.match(codeApi, /request\.headers\.get\("origin"\) !== policy\.previewOrigin/);
  assert.match(codeApi, /return json\(\{ error: "Request not permitted\." \}, 403\)/);
  assert.match(passwordHandler, /request\.headers\.get\("origin"\) !== policy\.previewOrigin/);
  assert.match(passwordHandler, /return json\(\{ error: "Request not permitted\." \}, 403\)/);
});

test("password login delegates only preview mode without changing ordinary JSON login", () => {
  assert.ok(passwordApi.indexOf("if (previewPolicy.enabled)") < passwordApi.indexOf("await request.json()"));
  assert.match(passwordApi, /if \(previewPolicy\.enabled\) \{\s*return previewPasswordLogin\(request\);\s*\}/);
  assert.match(passwordApi, /import \{ previewPasswordLogin \} from "@\/lib\/private-preview-password-route"/);
  assert.match(passwordEndpoint, /export const POST = previewPasswordLogin/);
  assert.match(passwordApi, /const body = await request\.json\(\)/);
  assert.match(passwordApi, /await bcrypt\.compare\(password, user\.passwordHash\)/);
  assert.match(passwordApi, /await createSession\(user\.id, membership\?\.organisationId \|\| null\)/);
  assert.match(passwordApi, /return NextResponse\.json\(\{\s*success: true,\s*recommendedDashboardRoute,/);
});

test("preview password handler is fail-closed, bounded, rate-limited and writes its cookie after authentication", () => {
  assert.match(passwordHandler, /if \(!policy\.enabled\) return json\(\{ error: "Not found\." \}, 404\)/);
  assert.match(passwordHandler, /if \(!policy\.valid\) return fail\("unavailable", 503\)/);
  assert.match(passwordHandler, /limit: 10, windowMs: 15 \* 60 \* 1000/);
  assert.match(passwordHandler, /readPrivatePreviewBody\(request, \["email", "password"\], \{ form: true \}\)/);
  assert.ok(passwordHandler.indexOf("await consumeRateLimit(") < passwordHandler.indexOf("await readPrivatePreviewBody("));
  assert.ok(passwordHandler.indexOf("await authenticatePreviewPassword(") < passwordHandler.indexOf("await setSessionCookie("));
  assert.ok(passwordHandler.indexOf("privatePreviewDashboardRoute(result.user, policy)") < passwordHandler.indexOf("await setSessionCookie("));
  assert.match(passwordHandler, /location: `\/preview-login\?error=\$\{reason\}`/);
  assert.match(passwordHandler, /status: 303, headers: \{ \.\.\.PREVIEW_RESPONSE_HEADERS, location: recommendedDashboardRoute \}/);
  assert.doesNotMatch(passwordHandler, /console\.|securityLog\([^\n]*(?:password|body|email)[,:]|searchParams\.get\(["'](?:next|returnTo|redirect)/i);
  assert.match(previewRequest, /Number\(size\) > 4096/);
  assert.match(previewRequest, /if \(bytes > 4096\)/);
  assert.match(previewRequest, /params\.getAll\(key\)\.length !== 1/);
  assert.match(previewRequest, /Object\.keys\(body\)\.some\(\(key\) => !fields\.includes\(key\)\)/);
  assert.match(previewRequest, /"cache-control": "private, no-store, max-age=0"/);
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

test("an existing valid preview session skips both sign-in URLs for a fixed permitted dashboard", () => {
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

test("owner controls distinguish one-time password bootstrap from password-authenticated management", () => {
  assert.match(ownerPage, /const bootstrap = isPrivatePreviewOwnerBootstrapSession\(session, policy\)/);
  assert.match(ownerPage, /if \(!bootstrap && !isPrivatePreviewAdminSession\(session, policy\)\) notFound\(\)/);
  assert.match(ownerPage, /const testers = bootstrap \? \[\] : await listPreviewTesters/);
  assert.match(ownerPage, /<PasswordControls bootstrap=\{bootstrap\} email=\{session\.user\.email\}/);
  assert.match(ownerPage, /\{!bootstrap \? <>\s*<TesterControls/);
  assert.match(previewPolicy, /session\?\.authMethod === "PREVIEW_PASSWORD" && isPrivatePreviewAdmin\(session\.user, policy\)/);
  assert.match(previewPolicy, /access\?\.userId === session\.user\.id && access\.enabled === true && access\.passwordEnabled === true/);
  assert.match(previewPolicy, /access\.organisationId === null && access\.expiresAt === null/);
  assert.match(previewPolicy, /Array\.isArray\(access\.pillars\) && access\.pillars\.length === 0/);
  assert.match(previewPolicy, /session\?\.authMethod === "PREVIEW_CODE" && isPrivatePreviewAdmin\(session\.user, policy\)/);
  assert.match(previewPolicy, /!session\.user\.privatePreviewAccess\.passwordEnabled/);
  assert.match(previewPolicy, /if \(isPrivatePreviewOwnerBootstrapSession\(session, policy\)\) return "\/admin\/private-preview"/);
  assert.match(middleware, /const bootstrapAllowed = \(path === "\/admin\/private-preview" && \["GET", "HEAD"\]\.includes\(request\.method\)\)/);
  assert.match(middleware, /path === "\/api\/admin\/private-preview\/password" && request\.method === "POST"/);
  assert.match(middleware, /bootstrap \? bootstrapAllowed :\s*privatePreviewTesterRequestAllowed/);
  assert.match(ownerPasswordApi, /!isPrivatePreviewAdminSession\(session, policy\) && !isPrivatePreviewOwnerBootstrapSession\(session, policy\)/);
  assert.match(ownerPasswordApi, /request\.headers\.get\("origin"\) !== policy\.previewOrigin/);
  assert.match(testerApi, /if \(!isPrivatePreviewAdminSession\(session, policy\)\) return json\(\{ error: "Access denied\." \}, 403\)/);
  assert.match(testerApi, /request\.headers\.get\("origin"\) !== policy\.previewOrigin/);
  assert.match(adminLayout, /canManagePreviewCodes = isPrivatePreviewAdmin\(adminUser, readPrivatePreviewPolicy\(\)\)/);
  assert.match(adminLayout, /canManagePreviewCodes \? <Link href="\/admin\/private-preview"/);
});

test("tester code management requires password owner and database-enrolled non-platform accounts", () => {
  assert.match(ownerApi, /if \(!isPrivatePreviewAdminSession\(session, policy\)\)/);
  assert.match(ownerApi, /request\.headers\.get\("origin"\) !== policy\.previewOrigin/);
  assert.doesNotMatch(ownerApi, /policy\.allowedEmails\.has\(email\)/);
  assert.match(ownerApi, /prisma\.user\.findUnique\(\{ where: \{ email \}, select: \{ id: true, role: true \} \}\)/);
  assert.match(ownerApi, /\["SUPER_ADMIN", "SUPPORT"\]\.includes\(target\.role\)/);
  assert.match(codeService, /privatePreviewAccess: true/);
  assert.match(codeService, /\["SUPER_ADMIN", "SUPPORT"\]\.includes\(target\.role\)/);
  assert.match(codeService, /!isPrivatePreviewUserAllowed\(target, policy\)/);
  assert.match(previewPolicy, /isPrivatePreviewTester\(user, policy/);
  assert.match(previewPolicy, /access\?\.enabled === true/);
  assert.match(previewPolicy, /access\.expiresAt instanceof Date && access\.expiresAt > now/);
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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isInsideDemoEnvironment } from "../lib/inside-demo-environment.mjs";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("fictional demo environment is an explicit, fail-closed mode", () => {
  assert.equal(isInsideDemoEnvironment({ RUVANAS_ENVIRONMENT: "DEMO" }), true);
  assert.equal(isInsideDemoEnvironment({ RUVANAS_ENVIRONMENT: "PRODUCTION" }), false);
  assert.equal(isInsideDemoEnvironment({}), false);
});

test("demo registration is rejected before code redemption, test bypass, or rate-limit writes", async () => {
  const [planRoute, codeRoute, teamAcceptRoute, studentAcceptRoute] = await Promise.all([
    source("app/api/auth/register/route.js"),
    source("app/api/complimentary-access/redeem/route.js"),
    source("app/api/organisation/team/accept/route.js"),
    source("app/api/school-student/accept/route.js")
  ]);

  for (const route of [planRoute, codeRoute]) {
    const guard = route.indexOf("if (isInsideDemoEnvironment())");
    assert.ok(guard > 0);
    assert.ok(guard < route.indexOf("consumeRateLimit({"));
    assert.match(route, /Account creation is unavailable in this fictional demo/);
    assert.match(route, /status: 403/);
  }
  assert.ok(planRoute.indexOf("if (isInsideDemoEnvironment())") < planRoute.indexOf("isInternalRegistrationTestRequest(request)"));
  assert.ok(codeRoute.indexOf("if (isInsideDemoEnvironment())") < codeRoute.indexOf("createComplimentaryRegistration(prisma"));
  assert.ok(teamAcceptRoute.indexOf("if (isInsideDemoEnvironment())") < teamAcceptRoute.indexOf("loadInvitation(body.token)"));
  assert.ok(studentAcceptRoute.indexOf("if (isInsideDemoEnvironment())") < studentAcceptRoute.indexOf("consumeRateLimit({"));
  assert.match(teamAcceptRoute, /Account invitations are unavailable in this fictional demo/);
  assert.match(studentAcceptRoute, /Account invitations are unavailable in this fictional demo/);
});

test("demo visitors see the fictional tour, not registration forms", async () => {
  const [home, register, freeAccess, teamAccept, studentAccept] = await Promise.all([
    source("app/page.js"),
    source("app/register/page.js"),
    source("app/register/free-access/page.js"),
    source("app/team-invitation/accept/page.js"),
    source("app/school-student/accept/page.js")
  ]);
  assert.match(home, /if \(isInsideDemoEnvironment\(\)\) redirect\("\/inside-demo"\)/);
  assert.match(register, /if \(isInsideDemoEnvironment\(\)\) notFound\(\)/);
  assert.match(freeAccess, /if \(isInsideDemoEnvironment\(\)\) notFound\(\)/);
  assert.match(freeAccess, /export const dynamic = "force-dynamic"/);
  assert.match(teamAccept, /if \(isInsideDemoEnvironment\(\)\) notFound\(\)/);
  assert.match(studentAccept, /if \(isInsideDemoEnvironment\(\)\) notFound\(\)/);
});

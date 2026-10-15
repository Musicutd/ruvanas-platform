import { test } from "node:test";
import assert from "node:assert/strict";
import { readPrivatePreviewBody } from "../lib/private-preview-request.mjs";

const request = (body, type = "application/json", extra = {}) => new Request("https://preview.test/login", {
  method: "POST", headers: { "content-type": type, ...extra }, body
});
test("preview password bodies accept only bounded known fields in JSON or native form", async () => {
  assert.deepEqual(await readPrivatePreviewBody(request('{"email":"owner@example.test","password":"synthetic"}'), ["email", "password"]),
    { email: "owner@example.test", password: "synthetic" });
  assert.deepEqual(await readPrivatePreviewBody(request("email=owner%40example.test&password=synthetic", "application/x-www-form-urlencoded"),
    ["email", "password"], { form: true }), { email: "owner@example.test", password: "synthetic" });
  for (const body of ['null', '[]', '{', '{"email":"x","next":"https://evil.test"}']) {
    await assert.rejects(readPrivatePreviewBody(request(body), ["email", "password"]));
  }
  await assert.rejects(readPrivatePreviewBody(request("email=x&email=y", "application/x-www-form-urlencoded"), ["email"], { form: true }));
  await assert.rejects(readPrivatePreviewBody(request("password=" + "x".repeat(4096), "application/x-www-form-urlencoded"), ["password"], { form: true }));
  await assert.rejects(readPrivatePreviewBody(request("{}", "application/json", { "content-length": "4097" }), ["email"]));
  await assert.rejects(readPrivatePreviewBody(request("{}", "text/plain"), ["email"]));
});

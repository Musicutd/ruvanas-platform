import assert from "node:assert/strict";
import { test } from "node:test";
import { isPrivatePreviewUserAllowed, readPrivatePreviewPolicy } from "../lib/private-preview-policy.mjs";

const PREVIEW_ORIGIN = "https://preview.ruvanas.test";

test("private preview is off by default and only exact 1 enables it", () => {
  const off = readPrivatePreviewPolicy({});
  assert.equal(off.enabled, false);
  assert.equal(off.valid, true);
  assert.equal(off.publicUrl, "https://www.ruvanas.com/");
  assert.equal(off.previewOrigin, null);
  assert.equal(isPrivatePreviewUserAllowed({ email: "any@example.com" }, off), true);
  assert.equal(readPrivatePreviewPolicy({ RUVANAS_PRIVATE_PREVIEW_ENABLED: "0" }).enabled, false);
  for (const mode of ["", "true", "yes", "01", "false"]) {
    const policy = readPrivatePreviewPolicy({ RUVANAS_PRIVATE_PREVIEW_ENABLED: mode });
    assert.equal(policy.enabled, true);
    assert.equal(policy.valid, false);
    assert.equal(isPrivatePreviewUserAllowed({ email: "owner@example.com" }, policy), false);
  }
});

test("enabled preview requires a strict individual-email allowlist", () => {
  const enabled = readPrivatePreviewPolicy({
    RUVANAS_PRIVATE_PREVIEW_ENABLED: "1",
    RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: " Owner@Example.com , invited@example.org ",
    RUVANAS_PUBLIC_URL: PREVIEW_ORIGIN
  });
  assert.equal(enabled.valid, true);
  assert.equal(enabled.previewOrigin, PREVIEW_ORIGIN);
  assert.deepEqual([...enabled.allowedEmails], ["owner@example.com", "invited@example.org"]);
  assert.equal(isPrivatePreviewUserAllowed({ email: "OWNER@example.com" }, enabled), true);
  assert.equal(isPrivatePreviewUserAllowed({ email: "other@example.com" }, enabled), false);
  assert.equal(isPrivatePreviewUserAllowed(null, enabled), false);

  for (const csv of [undefined, "", "owner@example.com,", ",owner@example.com",
    "owner@example.com,,other@example.com", "owner@example.com,OWNER@example.com",
    "bad-address", "owner@bad/.com"]) {
    assert.equal(readPrivatePreviewPolicy({
      RUVANAS_PRIVATE_PREVIEW_ENABLED: "1",
      RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: csv,
      RUVANAS_PUBLIC_URL: PREVIEW_ORIGIN
    }).valid, false);
  }
});

test("the public cover URL is fixed configuration, not request-supplied input", () => {
  const base = {
    RUVANAS_PRIVATE_PREVIEW_ENABLED: "1",
    RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.com",
    RUVANAS_PUBLIC_URL: PREVIEW_ORIGIN
  };
  assert.equal(readPrivatePreviewPolicy({ ...base,
    RUVANAS_PUBLIC_COMING_SOON_URL: "https://www.ruvanas.com/"
  }).valid, true);
  for (const url of ["http://www.ruvanas.com/", "https://user:pass@www.ruvanas.com/",
    "https://www.ruvanas.com/?next=evil", "https://www.ruvanas.com/#next",
    "javascript:alert(1)", " https://www.ruvanas.com/"]) {
    assert.equal(readPrivatePreviewPolicy({ ...base, RUVANAS_PUBLIC_COMING_SOON_URL: url }).valid, false);
  }
  assert.equal(readPrivatePreviewPolicy({ ...base, NODE_ENV: "development",
    RUVANAS_PUBLIC_COMING_SOON_URL: "http://127.0.0.1:3000/"
  }).valid, true);
  assert.equal(readPrivatePreviewPolicy({ ...base, NODE_ENV: "production",
    RUVANAS_PUBLIC_COMING_SOON_URL: "http://127.0.0.1:3000/"
  }).valid, false);

  // Disabled mode must preserve ordinary sign-in even if an unused preview URL is malformed.
  assert.equal(readPrivatePreviewPolicy({
    RUVANAS_PRIVATE_PREVIEW_ENABLED: "0",
    RUVANAS_PUBLIC_COMING_SOON_URL: "invalid"
  }).valid, true);
  assert.equal(readPrivatePreviewPolicy({
    RUVANAS_PRIVATE_PREVIEW_ENABLED: "0",
    RUVANAS_PUBLIC_URL: "https://www.ruvanas.com/"
  }).valid, true);
});

test("preview redirects require a configured absolute origin independent of request headers", () => {
  const base = {
    RUVANAS_PRIVATE_PREVIEW_ENABLED: "1",
    RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.com",
    NODE_ENV: "production"
  };
  assert.equal(readPrivatePreviewPolicy(base).valid, false);
  assert.equal(readPrivatePreviewPolicy({ ...base, RUVANAS_PUBLIC_URL: PREVIEW_ORIGIN }).previewOrigin,
    PREVIEW_ORIGIN);
  assert.equal(readPrivatePreviewPolicy({ ...base,
    RUVANAS_PUBLIC_URL: "https://www.ruvanas.com/"
  }).valid, false);
  assert.equal(readPrivatePreviewPolicy({ ...base,
    RUVANAS_PUBLIC_URL: "https://www.ruvanas.com",
    RUVANAS_PUBLIC_COMING_SOON_URL: "https://www.ruvanas.com/coming-soon"
  }).valid, false);
  assert.equal(readPrivatePreviewPolicy({ ...base,
    RUVANAS_PUBLIC_URL: `${PREVIEW_ORIGIN}/`
  }).previewOrigin, PREVIEW_ORIGIN);
  for (const origin of ["", "http://preview.ruvanas.test", "https://user:pass@preview.ruvanas.test",
    "https://@preview.ruvanas.test", "https://preview.ruvanas.test/private",
    "https://preview.ruvanas.test/a/..", "https://preview.ruvanas.test/?next=evil",
    "https://preview.ruvanas.test/?", "https://preview.ruvanas.test/#",
    " https://preview.ruvanas.test", "javascript:alert(1)"]) {
    assert.equal(readPrivatePreviewPolicy({ ...base, RUVANAS_PUBLIC_URL: origin }).valid, false,
      `Unsafe preview origin accepted: ${origin}`);
  }
  const loopback = "http://127.0.0.1:3124";
  assert.equal(readPrivatePreviewPolicy({ ...base, RUVANAS_PUBLIC_URL: loopback }).valid, false);
  assert.equal(readPrivatePreviewPolicy({ ...base, NODE_ENV: "development",
    RUVANAS_PUBLIC_URL: loopback }).previewOrigin, loopback);
  assert.equal(readPrivatePreviewPolicy({ ...base,
    RUVANAS_ENVIRONMENT: "LOCAL_SYNTHETIC_PRIVATE_PREVIEW",
    RUVANAS_PUBLIC_URL: loopback }).previewOrigin, loopback);
  assert.equal(readPrivatePreviewPolicy({ ...base,
    RUVANAS_ENVIRONMENT: "LOCAL_SYNTHETIC_PRIVATE_PREVIEW",
    RUVANAS_PUBLIC_URL: "http://preview.ruvanas.test" }).valid, false);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const page = await readFile(new URL("../coming-soon/index.html", import.meta.url), "utf8");

test("public cover describes one platform and exactly the seven intended pillars", () => {
  assert.match(page, /A new platform <em>is coming/);
  assert.match(page, /One Ruvanas Core/);
  const names = [...page.matchAll(/<h3>Ruvanas (Retail|School|Online Radio|Health|Faith|Organisations|Inside)<\/h3>/g)]
    .map((match) => match[1]);
  assert.deepEqual(names, ["Retail", "School", "Online Radio", "Health", "Faith", "Organisations", "Inside"]);
  assert.match(page, /Ruvanas Studio/);
  assert.match(page, /Complete radio software/);
  assert.match(page, /Fully Licensed Music Catalogue/);
  assert.match(page, /Soft Launch — December 2026/);
  assert.match(page, /Full Commercial Launch — January 2027/);
});

test("static cover never invites an undeliverable submission or exposes secrets", () => {
  assert.match(page, /Registration opens soon/);
  assert.match(page, /not collecting personal details yet/);
  assert.doesNotMatch(page, /<form\b|<input\b|<script\b|\/api\/interest|mailto:/i);
  assert.doesNotMatch(page, /RUVANAS_INTEREST_RECIPIENT|NOTIFICATION_EMAIL_TOKEN|Promo Only|frequency/i);
});

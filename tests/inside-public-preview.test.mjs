import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homepage = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

test("Inside homepage preview links only to the isolated fictional demo", () => {
  assert.match(homepage, /const insideDemoUrl = "https:\/\/ruvanas-inside-demo-20260930\.onrender\.com\/inside-demo"/);
  assert.match(homepage, /previewUrl: insideDemoUrl/);
  assert.match(homepage, /href=\{platform\.previewUrl\} target="_blank" rel="noopener noreferrer"/);
  assert.match(homepage, /Read-only example\. No real facility or customer data\./);
  assert.match(homepage, /Inside is not yet open for customer registration\./);
});

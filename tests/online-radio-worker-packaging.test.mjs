import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Online Radio image includes the exact postinstall helper before dependency installation", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile.online-radio-worker", import.meta.url), "utf8");
  const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(metadata.scripts.postinstall, /node scripts\/patch-next-middleware-finalize\.mjs/);
  const copy = dockerfile.indexOf("COPY scripts/patch-next-middleware-finalize.mjs ./scripts/");
  const install = dockerfile.indexOf("RUN npm ci");
  assert.ok(copy >= 0 && copy < install, "npm postinstall needs its helper inside the image before npm ci");
  await readFile(new URL("../scripts/patch-next-middleware-finalize.mjs", import.meta.url), "utf8");
});

test("Online Radio image keeps its existing normal worker entrypoint and syntax-only build check", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile.online-radio-worker", import.meta.url), "utf8");
  const checker = await readFile(new URL("../scripts/check-online-radio-liquidsoap.mjs", import.meta.url), "utf8");
  assert.match(dockerfile, /USER node[\s\S]+CMD \["node", "scripts\/online-radio-encoder-worker\.mjs", "--hold"\]/);
  assert.match(dockerfile, /RUN node scripts\/check-online-radio-liquidsoap\.mjs/);
  assert.match(dockerfile, /COPY scripts\/online-radio-encoder-worker\.mjs scripts\/online-radio-encoder-live\.mjs scripts\/online-radio-source-report\.mjs/);
  assert.match(dockerfile, /scripts\/online-radio-encoder-no-audio\.mjs scripts\/catalogue-test-worker\.mjs scripts\/check-online-radio-liquidsoap\.mjs/);
  assert.match(dockerfile, /RUN node scripts\/catalogue-test-worker\.mjs --check/);
  assert.match(checker, /spawnSync\("liquidsoap", \["--check", scriptPath\]/);
  assert.doesNotMatch(dockerfile, /db:migrate|start-production/);
  assert.doesNotMatch(dockerfile, /CMD[^\n]*catalogue-test-worker/);
});

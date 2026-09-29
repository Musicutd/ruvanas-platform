import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { correctionsScaleProbeOptions, runCorrectionsScaleProbe } from "../lib/corrections-c9-scale-probe.mjs";

test("C9 policy probe options are bounded and cover every synthetic facility", () => {
  assert.deepEqual(correctionsScaleProbeOptions({ facilities: 3, samples: 100 }), { facilities: 3, samples: 100 });
  assert.throws(() => correctionsScaleProbeOptions({ facilities: 101, samples: 1000 }), /between 3 and 100/);
  assert.throws(() => correctionsScaleProbeOptions({ facilities: 24, samples: 100 }), /cover every facility/);
  assert.throws(() => correctionsScaleProbeOptions({ facilities: 3, samples: 50_001 }), /50,000/);
});

test("C9 probe preserves Central, Local, return, private fallback and facility isolation", () => {
  const result = runCorrectionsScaleProbe({ facilities: 6, samples: 300 });
  assert.equal(result.kind, "synthetic_c7_policy_only");
  assert.equal(result.mismatchCount, 0);
  assert.deepEqual(result.scenarioCounts, {
    central: 60, localOrCentral: 60, returnToCentral: 60,
    privateFallback: 60, foreignFacilityDenied: 60
  });
  assert.equal(Number.isFinite(result.p95ResolveMs), true);
  assert.match(result.caveat, /No live player/);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-facility-\d|central-version-/);
});

test("C9 probe detects a resolver that borrows another facility's content", () => {
  const broken = runCorrectionsScaleProbe({ facilities: 3, samples: 100 }, {
    resolve: () => ({ id: "local-0", facilityId: "synthetic-facility-0" }),
    now: () => 1
  });
  assert.ok(broken.mismatchCount > 0);
});

test("C9 policy probe is in-process and does not reach production systems", () => {
  const source = readFileSync(new URL("../scripts/corrections-c9-scale-probe.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|Prisma|DATABASE_URL|https?:\/\//);
  assert.match(source, /runCorrectionsScaleProbe/);
});

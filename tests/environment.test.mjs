import test from "node:test";
import assert from "node:assert/strict";

import {
  requireEnvironment,
  requireEnvironmentGroup
} from "../lib/environment.mjs";

function withEnvironment(values, callback) {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]])
  );

  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }

    callback();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

test("required environment values are trimmed", () => {
  withEnvironment({ RUVANAS_TEST_VALUE: "  configured  " }, () => {
    assert.equal(requireEnvironment("RUVANAS_TEST_VALUE"), "configured");
  });
});

test("missing environment values fail with the variable name", () => {
  withEnvironment({ RUVANAS_TEST_VALUE: undefined }, () => {
    assert.throws(
      () => requireEnvironment("RUVANAS_TEST_VALUE"),
      /RUVANAS_TEST_VALUE/
    );
  });
});

test("environment groups report every missing value", () => {
  withEnvironment(
    { RUVANAS_TEST_ONE: "ready", RUVANAS_TEST_TWO: " " },
    () => {
      assert.throws(
        () =>
          requireEnvironmentGroup(
            ["RUVANAS_TEST_ONE", "RUVANAS_TEST_TWO"],
            "Test service"
          ),
        /Test service.*RUVANAS_TEST_TWO/
      );
    }
  );
});

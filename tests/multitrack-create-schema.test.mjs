import test from "node:test";
import assert from "node:assert/strict";
import { createMultitrackProjectSchema } from "../lib/multitrack-create-schema.mjs";

test("multitrack production can be created with a title and blank optional links", () => {
  const parsed = createMultitrackProjectSchema.parse({
    title: "  Test production  ", programmeId: "", episodeId: "", studentGroupId: ""
  });
  assert.deepEqual(parsed, {
    title: "Test production", programmeId: null, episodeId: null, studentGroupId: null
  });
});

test("multitrack production rejects an invalid linked ID", () => {
  assert.equal(createMultitrackProjectSchema.safeParse({ title: "Test production", programmeId: "not-an-id" }).success, false);
});

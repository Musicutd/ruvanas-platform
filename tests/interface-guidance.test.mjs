import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { confirmationCopy, interfaceMessages, safeInterfaceMessage } from "../lib/interface-guidance.mjs";

test("priority subscriber and administration screens share plain-language interface copy", () => {
  const expected = ["organisations", "locations", "stations", "musicModes", "schedules", "notifications", "analytics", "reports", "playerSessions"];
  assert.deepEqual(Object.keys(interfaceMessages), expected);
  for (const message of Object.values(interfaceMessages)) {
    assert.ok(message.title.length > 2);
    assert.ok(message.emptyTitle.length > 2);
    assert.ok(message.emptyDescription.length > 20);
    assert.doesNotMatch(message.title, /stage\s+\d/i);
  }
});

test("user-facing errors are bounded and flattened", () => {
  const message = safeInterfaceMessage(`Provider failed\n${"detail ".repeat(80)}`, "Please try again.", 90);
  assert.equal(message.length, 90);
  assert.doesNotMatch(message, /[\r\n\t]/);
  assert.equal(safeInterfaceMessage("", "Please try again."), "Please try again.");
});

test("dismiss confirmation explains that the operational record is retained", () => {
  const copy = confirmationCopy("DISMISS_NOTIFICATION", "Player offline");
  assert.match(copy.title, /Dismiss/);
  assert.match(copy.message, /not deleted/);
  assert.equal(copy.confirmLabel, "Dismiss notification");
});

test("archive confirmation explains the scheduling effect", () => {
  const copy = confirmationCopy("ARCHIVE_MUSIC_MODE", "Morning mode");
  assert.match(copy.message, /new scheduling choices/);
  assert.match(copy.message, /audit records remain/);
});

test("stop-session confirmation distinguishes a session from player enrolment", () => {
  const copy = confirmationCopy("STOP_PLAYER_SESSION", "Main shop player");
  assert.match(copy.message, /stream slot/);
  assert.match(copy.message, /remains registered/);
});

test("confirmation dialog supports keyboard dismissal and visible focus", async () => {
  const [component, styles] = await Promise.all([
    readFile(new URL("../app/components/ConfirmActionButton.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/interface-patterns.module.css", import.meta.url), "utf8")
  ]);
  assert.match(component, /addEventListener\("cancel"/);
  assert.match(component, /aria-labelledby/);
  assert.match(component, /aria-describedby/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media \(max-width: 620px\)/);
});

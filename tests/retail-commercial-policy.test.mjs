import test from "node:test";
import assert from "node:assert/strict";
import { normaliseRetailCommercialRule, normaliseRetailCommercialDraft, simulateRetailCommercialRule,
  retailCommercialLocalDate, retailCommercialRuleDescription } from "../lib/retail-commercial-policy.mjs";
const rule = overrides => ({ name: "Lunch break", mode: "EVERY_SONGS", spotIds: ["spot-a", "spot-b"], weekdays: [1, 2, 3, 4, 5], everySongs: 3, ...overrides });

test("ordered breaks follow every N music songs and do not count their own spots", () => {
  const result = simulateRetailCommercialRule(rule(), { songs: 9 });
  assert.deepEqual(result.events.map(row => row.afterSong), [3, 6, 9]);
  for (const event of result.events) { assert.deepEqual(event.spotIds, ["spot-a", "spot-b"]); assert.equal(event.returnsToMusic, true); }
  assert.equal(result.playbackConnected, false); assert.equal(result.illustrationOnly, true);
  assert.match(result.description, /3 music songs/);
});
test("ten-minute examples wait for a song and never promise an exact audio boundary", () => {
  const result = simulateRetailCommercialRule(rule({ mode: "EVERY_MINUTES", everyMinutes: 10 }), { minutes: 30 });
  assert.deepEqual(result.events.map(row => row.afterMinutes), [10, 20, 30]);
  assert.equal(result.events.every(row => row.afterCurrentSong === true && row.exactTime === undefined), true);
});
test("top-of-hour and half-hour schedules are distinct and honour selected days", () => {
  const hourly = rule({ mode: "TOP_OF_HOUR", hours: [9, 10, 12] });
  assert.deepEqual(simulateRetailCommercialRule(hourly, { minutes: 180 }).events.map(row => row.at), ["09:00", "10:00"]);
  assert.equal(simulateRetailCommercialRule(hourly, { weekday: 0 }).events.length, 0);
  const exact = rule({ mode: "SCHEDULED", times: ["09:30", "09:00"] });
  assert.deepEqual(simulateRetailCommercialRule(exact).events.map(row => row.at), ["09:00", "09:30"]);
  assert.match(retailCommercialRuleDescription(hourly), /top of/);
});
test("preview truncates bounded events and skips overlapping known breaks", () => {
  const result = simulateRetailCommercialRule(rule({ mode: "EVERY_MINUTES", everyMinutes: 1 }), {
    minutes: 5, maxEvents: 2, spots: [{ id: "spot-a", durationSeconds: 90 }, { id: "spot-b", durationSeconds: 30 }] });
  assert.deepEqual(result.events.map(row => row.afterMinutes), [1, 3]);
  assert.equal(result.skippedOverlaps, 2); assert.equal(result.truncated, true);
});
test("date windows and Malta local calendar govern illustration availability", () => {
  const dated = rule({ startsOn: "2026-10-28", endsOn: "2026-10-30" });
  assert.equal(simulateRetailCommercialRule(dated, { date: "2026-10-27" }).events.length, 0);
  assert.equal(simulateRetailCommercialRule(dated, { date: "2026-10-31" }).events.length, 0);
  assert.equal(retailCommercialLocalDate(new Date("2026-10-28T23:30:00Z")), "2026-10-29");
});
test("invalid frequencies, dates, controls and foreign input fields fail closed", () => {
  for (const invalid of [rule({ everySongs: 0 }), rule({ everySongs: 51 }), rule({ everySongs: "3" }),
    rule({ mode: "EVERY_MINUTES", everyMinutes: 181 }), rule({ mode: "SCHEDULED", times: ["09:15"] }),
    rule({ mode: "TOP_OF_HOUR", hours: [24] }), rule({ weekdays: [1, 1] }), rule({ spotIds: ["spot-a", "spot-a"] }),
    rule({ endsOn: "2026-02-30" }), rule({ startsOn: "2026-12-01", endsOn: "2026-11-01" }), rule({ organisationId: "other" }),
    rule({ name: "Bad\u0000name" })]) assert.throws(() => normaliseRetailCommercialRule(invalid));
  assert.throws(() => normaliseRetailCommercialDraft({ name: "Week", timezone: "UTC", rules: [] }));
  assert.throws(() => normaliseRetailCommercialDraft({ name: "Week", timezone: "Europe/Malta", rules: [rule(), rule()] }));
  assert.deepEqual(normaliseRetailCommercialDraft({ name: "No spots", timezone: "Europe/Malta", rules: [] }).rules, []);
});

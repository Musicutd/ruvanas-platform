import test from "node:test";
import assert from "node:assert/strict";
import { COMBINED_DELIVERY_NOTICE, combinedDeliveryCsv, combinedDeliverySummary, normaliseCombinedDeliveryFilters } from "../lib/combined-delivery-report.mjs";

test("combined delivery filters are bounded to protect reporting workloads", () => {
  assert.deepEqual(normaliseCombinedDeliveryFilters({ from: "2026-08-01", to: "2026-08-29" }, new Date("2026-08-29T10:00:00Z")).from, "2026-08-01");
  assert.equal(normaliseCombinedDeliveryFilters({ from: "2026-08-01", to: "2026-08-29", retailMediaOrderId: "order_123" }).retailMediaOrderId, "order_123");
  assert.throws(() => normaliseCombinedDeliveryFilters({ retailMediaOrderId: "unsafe/order" }), /order is invalid/);
  assert.throws(() => normaliseCombinedDeliveryFilters({ from: "2026-01-01", to: "2026-08-29" }), /93 days/);
});

test("combined summaries keep audio, visual, takeover, and commercial evidence separate", () => {
  assert.deepEqual(combinedDeliverySummary({ audio: [{ eventType: "COMPLETED" }, { eventType: "FAILED" }], visual: [{ eventType: "COMPLETED", takeoverId: "t1" }, { eventType: "COMPLETED", retailMediaOrderId: "o1" }] }), { audioCompleted: 1, audioFailed: 1, visualCompleted: 2, visualFailed: 0, takeoverCompleted: 1, retailMediaVisualCompleted: 1 });
});

test("CSV evidence is safe and reporting language makes no audience claim", () => {
  const csv = combinedDeliveryCsv([{ medium: "VISUAL", occurredAt: "2026-08-29T10:00:00Z", eventType: "COMPLETED", device: "Lobby, East", location: "Valletta", zone: "Entrance", content: "=unsafe", campaignOrOrder: "Order 1", takeover: "" }]);
  assert.match(csv, /"Lobby, East"/);
  assert.match(csv, /'=unsafe/);
  assert.match(COMBINED_DELIVERY_NOTICE, /do not represent listeners, viewers, impressions/);
});

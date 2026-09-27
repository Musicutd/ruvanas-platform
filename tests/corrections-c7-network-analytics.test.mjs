import test from "node:test";
import assert from "node:assert/strict";
import { correctionsNetworkDeliveryMetrics } from "../lib/corrections-network-analytics.mjs";

test("network analytics count only complete player proof as delivered", () => {
  const rows = [
    { source: "CORRECTIONS_CENTRAL", eventType: "STARTED", events: 4, deliveredSeconds: 0 },
    { source: "CORRECTIONS_CENTRAL", eventType: "COMPLETED", events: 2, deliveredSeconds: 240 },
    { source: "CORRECTIONS_LOCAL", eventType: "COMPLETED", events: 1, deliveredSeconds: 90 },
    { source: "CORRECTIONS_CENTRAL_REHAB", eventType: "COMPLETED", events: 1 },
    { source: "CORRECTIONS_REHABILITATION", eventType: "COMPLETED", events: 3 },
    { source: "CORRECTIONS_CENTRAL_ANNOUNCE", eventType: "COMPLETED", events: 2 },
    { source: "CORRECTIONS_REQUEST", eventType: "COMPLETED", events: 1 },
    { source: "CORRECTIONS_LOCAL", eventType: "FAILED", events: 1 },
    { source: "CORRECTIONS_PRIORITY", eventType: "INTERRUPTED", events: 1 }
  ];
  assert.deepEqual(correctionsNetworkDeliveryMetrics(rows), {
    centralProgramme: 2, localProgramme: 1, centralRehabilitation: 1, localRehabilitation: 3,
    centralAnnouncement: 2, facilityAnnouncement: 0, request: 1, failed: 1, interrupted: 1,
    centralDeliveredSeconds: 240, localDeliveredSeconds: 90
  });
});

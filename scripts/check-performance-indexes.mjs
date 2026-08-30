import { readFile } from "node:fs/promises";
import { modelHasDirective } from "../lib/performance-readiness.mjs";

const schema = await readFile("prisma/schema.prisma", "utf8");
const requirements = [
  ["ProofOfPlayEvent", "@@unique([clientEventId])"],
  ["ProofOfPlayEvent", "@@index([organisationId, occurredAt])"],
  ["ProofOfPlayEvent", "@@index([playerId, occurredAt])"],
  ["ProofOfPlayEvent", "@@index([campaignId, occurredAt])"],
  ["PlayoutIntent", "scheduleItemId String @unique"],
  ["PlayoutIntent", "@@index([organisationId, plannedStart])"],
  ["PlayoutIntent", "@@index([playerId, plannedStart])"],
  ["PlayerHeartbeatSample", "@@unique([playerId, bucketStart])"],
  ["PlayerHeartbeatSample", "@@index([organisationId, observedAt])"],
  ["Job", "@@index([status, availableAt, priority])"],
  ["Job", "@@index([leaseUntil])"],
  ["MusicSchedule", "@@index([organisationId, status])"],
  ["ScheduleSlot", "@@index([scheduleId, weekday, startMinute])"],
  ["Track", "@@index([status])"],
  ["Track", "@@index([artist, title])"]
];

const missing = requirements.filter(([model, directive]) => !modelHasDirective(schema, model, directive));
if (missing.length) {
  for (const [model, directive] of missing) process.stderr.write(`${model}: missing ${directive}\n`);
  process.stderr.write(`Critical performance-index check failed with ${missing.length} missing directive(s).\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(JSON.stringify({ event: "performance_indexes_verified", directivesChecked: requirements.length }) + "\n");
}

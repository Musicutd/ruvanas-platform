import { hostname } from "node:os";
import { prisma } from "../lib/prisma.js";
import { processJobBatch } from "../lib/job-notification-service.js";
import { processOutgoingWebhookBatch } from "../lib/outgoing-webhook-service.js";
import { PLAYER_HEALTH_SCAN_SECONDS } from "../lib/player-health.mjs";
import { scanPlayerHealth } from "../lib/player-health-service.js";
import { expirePlayerCommands } from "../lib/player-command-service.js";
import { scanStationStreamHealth } from "../lib/stream-source-health-service.js";

let stopping = false;
const workerId = String(process.env.RENDER_INSTANCE_ID || `operations-${hostname()}-${process.pid}`).slice(0, 120);
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { stopping = true; });

console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", event: "operations_worker_ready", workerId, scanSeconds: PLAYER_HEALTH_SCAN_SECONDS }));
while (!stopping) {
  try {
    const jobs = await processJobBatch(prisma, { workerId });
    if (jobs.claimed > 0) console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: jobs.deadLettered > 0 ? "error" : "info", event: "job_batch_processed", workerId, ...jobs }));
    const webhooks = await processOutgoingWebhookBatch(prisma);
    if (webhooks.claimed > 0) console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: webhooks.abandoned > 0 ? "error" : webhooks.failed > 0 ? "warn" : "info", event: "webhook_batch_processed", workerId, ...webhooks }));
    const result = await scanPlayerHealth(prisma);
    if (result.created > 0) console.warn(JSON.stringify({ level: "warn", event: "player_health_incident_opened", ...result }));
    const commands = await expirePlayerCommands(prisma);
    if (commands.expired > 0) console.log(JSON.stringify({ level: "info", event: "player_commands_expired", ...commands }));
    const streams = await scanStationStreamHealth(prisma);
    if (streams.scanned > 0) console.log(JSON.stringify({ level: streams.failing > 0 ? "warn" : "info", event: "station_stream_health_scanned", ...streams }));
  } catch (error) {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "error", event: "operations_scan_failed", workerId, errorCode: String(error?.code || error?.name || "OPERATIONS_SCAN_FAILED").slice(0, 80) }));
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, PLAYER_HEALTH_SCAN_SECONDS * 1_000));
}
await prisma.$disconnect();

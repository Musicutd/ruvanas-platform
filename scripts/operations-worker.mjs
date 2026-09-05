import { hostname } from "node:os";
import { prisma } from "../lib/prisma.js";
import { processJobBatch } from "../lib/job-notification-service.js";
import { processOutgoingWebhookBatch } from "../lib/outgoing-webhook-service.js";
import { PLAYER_HEALTH_SCAN_SECONDS } from "../lib/player-health.mjs";
import { scanPlayerHealth } from "../lib/player-health-service.js";
import { expirePlayerCommands } from "../lib/player-command-service.js";
import { scanStationStreamHealth } from "../lib/stream-source-health-service.js";
import { scanExternalLiveHealth } from "../lib/external-live-service.js";
import { scanLiveFailoverPolicies } from "../lib/live-failover-service.js";
import { scanStaleBrowserStudioSessions } from "../lib/browser-live-studio-service.js";
import { deploymentIdentity, safeOperationalErrorCode, structuredServiceLog } from "../lib/operational-observability.mjs";
import { recordServiceHeartbeat } from "../lib/operational-observability-service.js";

let stopping = false;
const workerId = String(process.env.RENDER_INSTANCE_ID || `operations-${hostname()}-${process.pid}`).slice(0, 120);
const processStartedAt = new Date();
const identity = deploymentIdentity({ service: "OPERATIONS_WORKER", instanceId: workerId, startedAt: processStartedAt });
const writeLog = (level, event, details = {}) => console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](structuredServiceLog(identity, level, event, details));
const writeJobLog = ({ timestamp: _timestamp, level, event, ...details } = {}) => writeLog(level, event, details);
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { stopping = true; });

writeLog("info", "operations_worker_ready", { scanSeconds: PLAYER_HEALTH_SCAN_SECONDS });
while (!stopping) {
  try {
    await recordServiceHeartbeat(prisma, { identity, details: { scanSeconds: PLAYER_HEALTH_SCAN_SECONDS } });
    const jobs = await processJobBatch(prisma, { workerId, log: writeJobLog });
    if (jobs.claimed > 0) writeLog(jobs.deadLettered > 0 ? "error" : "info", "job_batch_processed", jobs);
    const webhooks = await processOutgoingWebhookBatch(prisma);
    if (webhooks.claimed > 0) writeLog(webhooks.abandoned > 0 ? "error" : webhooks.failed > 0 ? "warn" : "info", "webhook_batch_processed", webhooks);
    const result = await scanPlayerHealth(prisma);
    if (result.created > 0) writeLog("warn", "player_health_incident_opened", result);
    const commands = await expirePlayerCommands(prisma);
    if (commands.expired > 0) writeLog("info", "player_commands_expired", commands);
    const streams = await scanStationStreamHealth(prisma);
    if (streams.scanned > 0) writeLog(streams.failing > 0 ? "warn" : "info", "station_stream_health_scanned", streams);
    const externalLive = await scanExternalLiveHealth(prisma);
    if (externalLive.scanned > 0) writeLog(externalLive.failing > 0 ? "warn" : "info", "external_live_health_scanned", externalLive);
    const failover = await scanLiveFailoverPolicies(prisma);
    if (failover.scanned > 0) writeLog(failover.onScheduledFallback > 0 ? "warn" : "info", "live_failover_policies_scanned", failover);
    const browserStudios = await scanStaleBrowserStudioSessions(prisma);
    if (browserStudios.scanned > 0) writeLog(browserStudios.fallback > 0 ? "warn" : "info", "browser_live_studios_scanned", browserStudios);
  } catch (error) {
    writeLog("error", "operations_scan_failed", { errorCode: safeOperationalErrorCode(error, "OPERATIONS_SCAN_FAILED") });
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, PLAYER_HEALTH_SCAN_SECONDS * 1_000));
}
await prisma.$disconnect();

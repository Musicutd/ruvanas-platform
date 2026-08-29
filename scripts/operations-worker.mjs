import { prisma } from "../lib/prisma.js";
import { PLAYER_HEALTH_SCAN_SECONDS } from "../lib/player-health.mjs";
import { scanPlayerHealth } from "../lib/player-health-service.js";

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { stopping = true; });

console.log(JSON.stringify({ level: "info", event: "operations_worker_ready", scanSeconds: PLAYER_HEALTH_SCAN_SECONDS }));
while (!stopping) {
  try {
    const result = await scanPlayerHealth(prisma);
    if (result.created > 0) console.warn(JSON.stringify({ level: "warn", event: "player_health_incident_opened", ...result }));
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "player_health_scan_failed", message: String(error?.message || error).slice(0, 1_000) }));
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, PLAYER_HEALTH_SCAN_SECONDS * 1_000));
}
await prisma.$disconnect();


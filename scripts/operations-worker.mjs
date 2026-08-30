import { prisma } from "../lib/prisma.js";
import { PLAYER_HEALTH_SCAN_SECONDS } from "../lib/player-health.mjs";
import { scanPlayerHealth } from "../lib/player-health-service.js";
import { expirePlayerCommands } from "../lib/player-command-service.js";
import { scanStationStreamHealth } from "../lib/stream-source-health-service.js";

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { stopping = true; });

console.log(JSON.stringify({ level: "info", event: "operations_worker_ready", scanSeconds: PLAYER_HEALTH_SCAN_SECONDS }));
while (!stopping) {
  try {
    const result = await scanPlayerHealth(prisma);
    if (result.created > 0) console.warn(JSON.stringify({ level: "warn", event: "player_health_incident_opened", ...result }));
    const commands = await expirePlayerCommands(prisma);
    if (commands.expired > 0) console.log(JSON.stringify({ level: "info", event: "player_commands_expired", ...commands }));
    const streams = await scanStationStreamHealth(prisma);
    if (streams.scanned > 0) console.log(JSON.stringify({ level: streams.failing > 0 ? "warn" : "info", event: "station_stream_health_scanned", ...streams }));
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "operations_scan_failed", message: String(error?.message || error).slice(0, 1_000) }));
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, PLAYER_HEALTH_SCAN_SECONDS * 1_000));
}
await prisma.$disconnect();

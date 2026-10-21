// Safe dispatcher. No database, cloud, credential or audio imports in hold/check.
import { pathToFileURL } from "node:url";
import path from "node:path";

export function encoderCommandMode(args = [], env = {}) {
  if (!Array.isArray(args) || args.length > 1 || args.some(arg => typeof arg !== "string")) throw new Error("ENCODER_ARGUMENTS_INVALID");
  if (!args.length || args[0] === "--check") return "CHECK_ONLY";
  if (args[0] === "--hold") return "HELD_OFF_AIR";
  if (args[0] === "--serve" && env.RUVANAS_AUTODJ_ALLOW_LIVE === "true") return "EXPLICIT_LIVE";
  throw new Error("ENCODER_LIVE_NOT_APPROVED");
}

export async function runEncoderCommand(args = [], env = process.env) {
  const mode = encoderCommandMode(args, env);
  if (mode === "EXPLICIT_LIVE") {
    const { runLiveEncoder } = await import("./online-radio-encoder-live.mjs");
    return runLiveEncoder();
  }
  const result = { service: "ONLINE_RADIO_ENCODER", mode, streamingStarted: false, cloudAccessed: false };
  if (mode === "CHECK_ONLY") return result;
  console.log(JSON.stringify(result));
  await new Promise(resolve => {
    const done = () => { clearInterval(timer); process.removeListener("SIGINT", done); process.removeListener("SIGTERM", done); resolve(); };
    const timer = setInterval(() => {}, 60000);
    process.once("SIGINT", done); process.once("SIGTERM", done);
  });
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { const result = await runEncoderCommand(process.argv.slice(2)); if (result) console.log(JSON.stringify(result)); }
  catch { console.error("Encoder command refused or stopped. Default/check/hold modes send no audio; serving requires separate approval."); process.exitCode = 1; }
}

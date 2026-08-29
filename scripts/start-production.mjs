import { spawn } from "node:child_process";

const requiredWorkerEnvironment = ["DATABASE_URL", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
const children = [];
const start = (command, args) => {
  const child = spawn(command, args, { stdio: "inherit", shell: process.platform === "win32", env: process.env });
  children.push(child);
  return child;
};

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const web = start(npmCommand, ["run", "start:web", "--", ...process.argv.slice(2)]);
if (process.env.DATABASE_URL?.trim()) {
  start(process.execPath, ["scripts/operations-worker.mjs"]);
}
if (requiredWorkerEnvironment.every((name) => process.env[name]?.trim())) {
  start(process.execPath, ["scripts/audio-worker.mjs"]);
} else {
  console.log("Protected media worker skipped because protected storage is not configured in this environment.");
}

function shutdown(signal) {
  for (const child of children) if (!child.killed) child.kill(signal);
}
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => shutdown(signal));
web.once("exit", (code) => { shutdown("SIGTERM"); process.exitCode = code || 0; });



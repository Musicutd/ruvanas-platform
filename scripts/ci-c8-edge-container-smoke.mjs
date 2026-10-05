// CI-only packaging smoke: synthetic keys, no cloud network, no customer data.
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

if (process.env.GITHUB_ACTIONS !== "true" || process.env.C8_CONTAINER_SMOKE !== "true") {
  throw new Error("The C8 container smoke is restricted to its isolated GitHub CI job.");
}

const image = "ruvanas-c8-edge:ci";
const docker = (args, timeout = 30_000) => spawnSync("docker", args, {
  encoding: "utf8", timeout, maxBuffer: 1024 * 1024
});
const requireDockerSuccess = (result, action) => {
  if (result.error || result.status !== 0) {
    throw new Error(`${action} failed: ${result.error?.message || result.stderr?.trim() || result.stdout?.trim() || "unknown Docker error"}`);
  }
  return result.stdout.trim();
};

const deniedStartup = docker(["run", "--rm", "--network", "none", image]);
if (deniedStartup.error || deniedStartup.status === 0 ||
    !`${deniedStartup.stderr}${deniedStartup.stdout}`.includes("EDGE_NODE_ID must be provisioned")) {
  throw new Error("An unprovisioned Edge container did not fail closed at startup.");
}

const cloudKey = generateKeyPairSync("ed25519");
const proofKey = generateKeyPairSync("ed25519");
const nodeId = `c8-container-ci-${randomUUID()}`;
const containerName = `ruvanas-c8-smoke-${randomUUID()}`;
const env = {
  EDGE_NODE_ID: nodeId,
  EDGE_ORGANISATION_ID: `synthetic-org-${randomUUID()}`,
  EDGE_FACILITY_ID: `synthetic-facility-${randomUUID()}`,
  EDGE_CLOUD_URL: "http://127.0.0.1:9109",
  EDGE_MACHINE_CREDENTIAL: `rve.${nodeId}.synthetic-ci-only`,
  EDGE_CACHE_DIR: "/tmp/ruvanas-c8-container-smoke",
  EDGE_CACHE_KEY: randomBytes(32).toString("base64url"),
  EDGE_CLOUD_PUBLIC_KEY: cloudKey.publicKey.export({ type: "spki", format: "pem" }),
  EDGE_PROOF_PRIVATE_KEY: proofKey.privateKey.export({ type: "pkcs8", format: "pem" }),
  EDGE_LISTEN_HOST: "127.0.0.1",
  EDGE_LISTEN_PORT: "8443"
};
const envArgs = Object.entries(env).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
let started = false;
try {
  requireDockerSuccess(docker([
    "run", "--detach", "--rm", "--name", containerName,
    "--network", "none", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--pids-limit", "64",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m,mode=1777",
    ...envArgs, image
  ]), "Starting the isolated synthetic Edge container");
  started = true;

  const probe = `
    import { setTimeout as delay } from "node:timers/promises";
    const base = "http://127.0.0.1:8443";
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(base + "/v1/playback", { signal: AbortSignal.timeout(1000) });
        if (response.status === 401) { ready = true; break; }
      } catch { /* Startup is not complete yet. */ }
      await delay(250);
    }
    if (!ready) throw new Error("The Edge did not start in its network-isolated container.");
    const checks = [
      ["/v1/playback", {}, 401],
      ["/v1/session", { method: "POST", headers: { "content-type": "application/json" }, body: '{"grant":null}' }, 401],
      ["/v1/media/" + "a".repeat(64), {}, 401],
      ["/v1/attest", {}, 403],
      ["/v1/playback", { headers: { Origin: "https://untrusted.example.invalid" } }, 403]
    ];
    for (const [path, options, expected] of checks) {
      const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(3000) });
      if (response.status !== expected) throw new Error(path + " returned " + response.status + ", expected " + expected);
      if (response.headers.get("cache-control") !== "private, no-store") {
        throw new Error(path + " must not be cached.");
      }
    }
    console.log("Synthetic offline Edge started; ungranted playback/media and invalid challenges/origins denied.");
  `;
  requireDockerSuccess(docker(["exec", containerName, "node", "--input-type=module", "-e", probe], 40_000),
    "Probing the isolated synthetic Edge container");
  console.log("C8 synthetic container startup and fail-closed checks passed.");
} finally {
  if (started) docker(["rm", "--force", containerName], 15_000);
}

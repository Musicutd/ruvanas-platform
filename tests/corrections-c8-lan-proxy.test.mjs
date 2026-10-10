import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLanProxy, isAllowedMachineRoute, isPrivateLanIpv4,
  validateLanProxyConfig } from "../scripts/c8-lan-proxy.mjs";
import { validateLanPreflightConfig } from "../scripts/c8-lan-preflight.mjs";

const base = {
  C8_TWO_HOST_LAB: "true", C8_SYNTHETIC_ONLY: "true",
  C8_LAN_CLOUD_IP: "192.168.42.10", C8_LAN_EDGE_IP: "192.168.42.11",
  C8_LAN_CLOUD_PORT: "9443", C8_LAN_LINK_PORT: "3118"
};

test("C8 LAN transport refuses production, public or same-host settings", () => {
  for (const ip of ["8.8.8.8", "127.0.0.1", "0.0.0.0", "ruvanas.com", "169.254.1.2", "::1"]) {
    assert.equal(isPrivateLanIpv4(ip), false);
  }
  for (const ip of ["10.0.0.2", "172.16.0.2", "172.31.255.2", "192.168.42.10"]) {
    assert.equal(isPrivateLanIpv4(ip), true);
  }
  const link = { ...base, C8_LAN_PROXY_MODE: "edge-link", C8_LAN_CA_CERT_FILE: "unused" };
  assert.throws(() => validateLanProxyConfig({ ...link, NODE_ENV: "production" }), /non-production/);
  assert.throws(() => validateLanProxyConfig({ ...link, C8_SYNTHETIC_ONLY: "false" }), /synthetic-only/);
  assert.throws(() => validateLanProxyConfig({ ...link, C8_LAN_EDGE_IP: base.C8_LAN_CLOUD_IP }), /distinct/);
  assert.throws(() => validateLanProxyConfig({ ...link, C8_LAN_CLOUD_IP: "8.8.8.8" }), /RFC1918/);
  assert.throws(() => validateLanProxyConfig({ ...link, C8_LAN_LINK_PORT: "80" }), /unprivileged/);
  const checked = validateLanProxyConfig(link);
  assert.equal(checked.listenHost, "127.0.0.1");
  assert.equal(checked.target.origin, "https://192.168.42.10:9443");
});

test("C8 cloud gateway refuses any non-disposable database", () => {
  const cloud = { ...base, C8_LAN_PROXY_MODE: "cloud", C8_LAN_TLS_KEY_FILE: "key",
    C8_LAN_TLS_CERT_FILE: "cert" };
  assert.throws(() => validateLanProxyConfig(cloud), /exact disposable/);
  assert.throws(() => validateLanProxyConfig({ ...cloud,
    DATABASE_URL: "postgresql://c8lab@127.0.0.1:5548/ruvanas" }), /exact disposable/);
  const checked = validateLanProxyConfig({ ...cloud,
    DATABASE_URL: "postgresql://c8lab@127.0.0.1:5548/ruvanas_c8_migration_clean" });
  assert.equal(checked.listenHost, "192.168.42.10");
  assert.equal(checked.target.origin, "http://127.0.0.1:3108");
});

test("C8 preflight requires private distinct TLS origins and explicit trust files", () => {
  const input = { ...base, C8_LAN_CLOUD_ORIGIN: "https://192.168.42.10:9443",
    C8_LAN_EDGE_ORIGIN: "https://192.168.42.11:8443",
    C8_LAN_CA_CERT_FILE: "cloud-ca.pem", C8_LAN_EDGE_CA_CERT_FILE: "edge-ca.pem",
    C8_LAN_BOOTSTRAP_FILE: "synthetic-edge-bootstrap.json" };
  assert.equal(validateLanPreflightConfig(input).edge.origin, input.C8_LAN_EDGE_ORIGIN);
  assert.throws(() => validateLanPreflightConfig({ ...input, C8_LAN_EDGE_ORIGIN: "https://ruvanas.com" }), /RFC1918/);
  assert.throws(() => validateLanPreflightConfig({ ...input,
    C8_LAN_CLOUD_ORIGIN: "https://192.168.42.11:9443" }), /different LAN PCs/);
  assert.throws(() => validateLanPreflightConfig({ ...input, C8_LAN_EDGE_CA_CERT_FILE: "" }), /required/);
  assert.throws(() => validateLanPreflightConfig({ ...input, C8_TWO_HOST_LAB: "false" }), /synthetic-only/);
});

test("C8 transport permits only the exact machine API surface", () => {
  for (const [method, pathname] of [["POST", "/api/corrections/edge/heartbeat"],
    ["POST", "/api/corrections/edge/sync"], ["POST", "/api/corrections/edge/proof"],
    ["GET", "/api/corrections/edge/manifest"],
    ["GET", "/api/corrections/edge/media/cm12345678901234567890123"]]) {
    assert.equal(isAllowedMachineRoute(method, pathname), true);
  }
  for (const [method, pathname] of [["GET", "/"], ["GET", "/player"],
    ["POST", "/api/auth/login"], ["POST", "/api/corrections/edge/enrol"],
    ["GET", "/api/corrections/edge/proof"], ["GET", "/api/corrections/edge/media/../manifest"]]) {
    assert.equal(isAllowedMachineRoute(method, pathname), false);
  }
});

test("loopback cloud-link rejects browser and admin routes without forwarding", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "c8-lan-proxy-test-"));
  const caFile = path.join(root, "ca.pem");
  await writeFile(caFile, "synthetic test CA; no outbound request occurs");
  const server = createLanProxy(validateLanProxyConfig({ ...base,
    C8_LAN_PROXY_MODE: "edge-link", C8_LAN_CA_CERT_FILE: caFile }));
  try {
    await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${url}/player`)).status, 404);
    assert.equal((await fetch(`${url}/api/corrections/edge/enrol`, { method: "POST" })).status, 404);
    assert.equal((await fetch(`${url}/__c8_lab_link_health`)).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    const resolvedRoot = await realpath(root);
    const resolvedTemp = await realpath(os.tmpdir());
    if (path.dirname(resolvedRoot) !== resolvedTemp ||
        !path.basename(resolvedRoot).startsWith("c8-lan-proxy-test-")) {
      throw new Error("Refusing cleanup outside the exact disposable C8 test directory.");
    }
    await rm(root, { recursive: true, force: true });
  }
});

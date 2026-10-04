import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { checkServerIdentity } from "node:tls";
import { fileURLToPath } from "node:url";

// Development-only transport for a two-host, synthetic-data C8 lab. It does
// not provision the application, credentials, trust anchors or firewall.
export function isPrivateLanIpv4(value) {
  if (net.isIP(value) !== 4) return false;
  const [a, b] = value.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function port(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
    throw new Error("Choose an unprivileged, explicit lab port (1024–65535).");
  }
  return parsed;
}

export function validateLanProxyConfig(env) {
  if (env.C8_TWO_HOST_LAB !== "true" || env.C8_SYNTHETIC_ONLY !== "true" || env.NODE_ENV === "production") {
    throw new Error("C8 LAN transport requires explicit non-production, synthetic-only lab flags.");
  }
  const cloudIp = env.C8_LAN_CLOUD_IP;
  const edgeIp = env.C8_LAN_EDGE_IP;
  if (!isPrivateLanIpv4(cloudIp) || !isPrivateLanIpv4(edgeIp) || cloudIp === edgeIp) {
    throw new Error("Provide two distinct RFC1918 IPv4 addresses for the cloud and Edge PCs.");
  }
  const mode = env.C8_LAN_PROXY_MODE;
  if (mode === "cloud") {
    if (env.DATABASE_URL !== "postgresql://c8lab@127.0.0.1:5548/ruvanas_c8_migration_clean") {
      throw new Error("The cloud gateway requires the exact disposable C8 lab database URL.");
    }
    if (!env.C8_LAN_TLS_KEY_FILE || !env.C8_LAN_TLS_CERT_FILE) {
      throw new Error("The cloud gateway needs an explicit lab TLS key and certificate file.");
    }
    return { mode, cloudIp, edgeIp, listenHost: cloudIp,
      listenPort: port(env.C8_LAN_CLOUD_PORT), target: new URL("http://127.0.0.1:3108"),
      keyFile: env.C8_LAN_TLS_KEY_FILE, certFile: env.C8_LAN_TLS_CERT_FILE };
  }
  if (mode === "edge-link") {
    if (!env.C8_LAN_CA_CERT_FILE) throw new Error("The Edge link needs the lab cloud certificate/CA file.");
    return { mode, cloudIp, edgeIp, listenHost: "127.0.0.1",
      listenPort: port(env.C8_LAN_LINK_PORT),
      target: new URL(`https://${cloudIp}:${port(env.C8_LAN_CLOUD_PORT)}`),
      caFile: env.C8_LAN_CA_CERT_FILE };
  }
  throw new Error("Choose C8_LAN_PROXY_MODE=cloud or edge-link.");
}

export function isAllowedMachineRoute(method, pathname) {
  return (method === "POST" && /^\/api\/corrections\/edge\/(heartbeat|sync|proof)$/.test(pathname)) ||
    (method === "GET" && (pathname === "/api/corrections/edge/manifest" ||
      /^\/api\/corrections\/edge\/media\/[a-z0-9]{20,40}$/.test(pathname)));
}

function deny(response, status = 403) {
  response.writeHead(status, { "cache-control": "no-store", "content-type": "text/plain" });
  response.end("C8 lab route unavailable.\n");
}

export function createLanProxy(config) {
  const ca = config.mode === "edge-link" ? readFileSync(config.caFile) : undefined;
  const handler = (request, response) => {
    const remote = request.socket.remoteAddress?.replace(/^::ffff:/, "");
    if (config.mode === "cloud" && remote !== config.edgeIp) {
      return deny(response);
    }
    if (config.mode === "edge-link" && remote !== "127.0.0.1" && remote !== "::1") {
      return deny(response);
    }
    const path = new URL(request.url, "http://lab.invalid").pathname;
    if (config.mode === "edge-link") {
      if (path === "/__c8_lab_link_health" && request.method === "GET") {
        response.writeHead(200, { "cache-control": "no-store", "content-type": "text/plain" });
        response.end("Edge cloud-link process running. This is not a cloud or Edge health claim.\n");
        return;
      }
    }
    if (!isAllowedMachineRoute(request.method, path)) return deny(response, 404);
    const headers = { ...request.headers, host: config.target.host };
    delete headers.connection;
    delete headers["proxy-connection"];
    if (config.mode === "cloud") {
      headers["x-forwarded-host"] = request.headers.host;
      headers["x-forwarded-proto"] = "https";
    }
    const upstream = (config.mode === "cloud" ? http : https).request({
      hostname: config.target.hostname, port: config.target.port, method: request.method,
      path: request.url, headers,
      ...(ca ? { ca, rejectUnauthorized: true,
        checkServerIdentity: (host, cert) => checkServerIdentity(config.target.hostname, cert) } : {}),
      timeout: 30_000
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on("timeout", () => upstream.destroy(new Error("Lab upstream timed out.")));
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502, { "cache-control": "no-store" });
      response.end();
    });
    request.on("aborted", () => upstream.destroy());
    request.pipe(upstream);
  };
  return config.mode === "cloud" ? https.createServer({
    key: readFileSync(config.keyFile), cert: readFileSync(config.certFile)
  }, handler) : http.createServer(handler);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const config = validateLanProxyConfig(process.env);
    const server = createLanProxy(config);
    server.listen(config.listenPort, config.listenHost, () => {
      console.info(`C8 synthetic ${config.mode} transport listening on ${config.listenHost}:${config.listenPort}.`);
    });
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
      server.closeAllConnections();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 5000).unref();
    });
  } catch (error) {
    console.error(`C8 lab transport refused to start: ${error.message}`);
    process.exitCode = 1;
  }
}

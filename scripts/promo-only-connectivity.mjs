import { pathToFileURL } from "node:url";
import { PromoOnlyTokenManager, safePromoOnlyClientError } from "../lib/promo-only-client.mjs";

// No dotenv loading, catalogue query, database write, media download or secret
// output. Live mode is explicit; credentials stay in the process environment.
export async function checkPromoOnlyConnectivity({ env = process.env, live = false, fetchImpl = fetch } = {}) {
  const config = {
    userId: String(env.PROMOONLY_USER_ID || "").trim(),
    apiKey: String(env.PROMOONLY_API_KEY || "").trim(),
    apiSecret: String(env.PROMOONLY_API_SECRET || "").trim(),
    requestTimeoutMs: 20_000, retryMax: 0
  };
  if (!config.userId || !config.apiKey || !config.apiSecret) {
    return { status: "BLOCKED", code: "PROMOONLY_CREDENTIALS_REQUIRED", networkAttempted: false };
  }
  if (!/^[1-9][0-9]*$/.test(config.userId) || !Number.isSafeInteger(Number(config.userId))) {
    return { status: "BLOCKED", code: "PROMOONLY_USER_ID_INVALID", networkAttempted: false };
  }
  if (!live) return { status: "READY", credentialsConfigured: true, networkAttempted: false, liveFlagRequired: true };
  const manager = new PromoOnlyTokenManager(config, { fetchImpl });
  try {
    const token = await manager.getToken();
    const response = await fetchImpl("https://api.promoonly.com/user/token/validate", {
      method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ userid: config.userId, token }),
      redirect: "error", signal: AbortSignal.timeout(config.requestTimeoutMs)
    });
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("json")) {
      return { status: "FAILED", code: "PROMOONLY_VALIDATION_RESPONSE_REJECTED", networkAttempted: true };
    }
    // Validation has one small status field; never buffer an unbounded body.
    const reader = response.body?.getReader();
    if (!reader) return { status: "FAILED", code: "PROMOONLY_VALIDATION_RESPONSE_REJECTED", networkAttempted: true };
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel().catch(() => {});
        return { status: "FAILED", code: "PROMOONLY_VALIDATION_RESPONSE_REJECTED", networkAttempted: true };
      }
      chunks.push(Buffer.from(value));
    }
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return { status: "FAILED", code: "PROMOONLY_VALIDATION_RESPONSE_REJECTED", networkAttempted: true }; }
    if (payload?.token !== "valid") return { status: "FAILED", code: "PROMOONLY_TOKEN_NOT_VALID", networkAttempted: true };
    return { status: "PASS", authenticated: true, tokenValid: true, networkAttempted: true,
      catalogueQueried: false, audioDownloaded: false, commercialRightsVerified: false };
  } catch (error) {
    return { status: "FAILED", code: safePromoOnlyClientError(error), networkAttempted: true };
  } finally { manager.clear(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !["--check", "--live"].includes(args[0]))) {
    console.error(JSON.stringify({ event: "promo_only_connectivity", status: "FAILED", code: "INVALID_ARGUMENTS" }));
    process.exitCode = 1;
  } else {
    const result = await checkPromoOnlyConnectivity({ live: args[0] === "--live" });
    console.info(JSON.stringify({ event: "promo_only_connectivity", ...result }));
    if (!["PASS", "READY"].includes(result.status)) process.exitCode = 1;
  }
}

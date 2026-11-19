export function checkoutAmountMinor(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount <= 100_000_000 ? amount : null;
}

export function checkoutMessage(code) {
  return ({
    LIMIT_REACHED: "This offer or shop has reached an allowed use limit. A coupon does not reserve a use. Please try another offer or contact the shop.",
    CLAIM_UNAVAILABLE: "This coupon is not available for this checkout. Check the shop and ask the shopper to open their coupon again.",
    CLAIM_EXPIRED: "This coupon or checkout code has expired. Ask the shopper to open their coupon and check its status.",
    ALREADY_REDEEMED: "This coupon has already been redeemed. It cannot be used again.",
    CONFLICT: "The request has changed or another coupon is already active. Refresh your coupons before starting another request.",
    UNAUTHENTICATED: "Your access could not be confirmed. Please sign in again.",
    FORBIDDEN: "You do not have permission to perform this action.",
    NOT_ENTITLED: "Rewards access is not currently available for this shop.",
    FEATURE_DISABLED: "Coupon checkout is not available right now.",
    RATE_LIMITED: "Too many requests. Please wait before trying again.",
    INVALID_REQUEST: "Check the code, shop and purchase details before trying again."
  })[code] || "We couldn’t confirm the result. Retry the same request to check it safely.";
}

export const checkoutTransport = (path, options) => fetch(path, options);
export async function checkoutRequest(transport, path, { method = "GET", body, signal } = {}) {
  const response = await transport(path, { method, credentials: "same-origin", cache: "no-store", signal,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const result = typeof response?.json === "function" ? await response.json() : response;
  if (signal?.aborted) throw new Error("Request cancelled");
  if (result?.ok !== true || response?.ok === false) {
    const error = new Error(checkoutMessage(result?.code)); error.code = result?.code; throw error;
  }
  return result;
}

// Ephemeral browser retry state. Never persist this key or any payload in
// storage, URLs or logs. Changing a payload deliberately creates a new request.
export function checkoutAttempt(previous, payload, makeKey = () => crypto.randomUUID()) {
  const fingerprint = JSON.stringify(payload);
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, key: makeKey() };
}

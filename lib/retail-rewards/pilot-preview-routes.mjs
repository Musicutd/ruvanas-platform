// Deliberately enumerate the reviewed pilot surface. A new route is not
// automatically admitted by sharing a prefix; handlers still authorise roles.
const reads = new Set(["GET", "HEAD"]);
const merchantPages = new Set(["", "/staff", "/reports", "/redeem", "/corrections", "/campaigns", "/campaign-links"].map(s => `/dashboard/retail/rewards${s}`));
const merchantGet = new Set(["/api/retail-rewards/offers", "/api/retail-rewards/reports/locations", "/api/retail-rewards/checkout/locations", "/api/retail-rewards/reversals/locations"]);
const merchantPost = new Set(["/api/retail-rewards/offers", "/api/retail-rewards/reports/query", "/api/retail-rewards/reports/export", "/api/retail-rewards/campaign-review/review", "/api/retail-rewards/campaign-links/save", "/api/retail-rewards/checkout/validate", "/api/retail-rewards/checkout/redeem", "/api/retail-rewards/reversals/inspect", "/api/retail-rewards/reversals/reverse"]);
const id = "[A-Za-z0-9][A-Za-z0-9_-]{0,190}";
const offerRead = new RegExp(`^/api/retail-rewards/offers/${id}$`);
const offerAction = new RegExp(`^/api/retail-rewards/offers/${id}/(?:publish|pause|resume|cancel)$`);
const shopRead = new RegExp(`^/api/rewards/discovery/shops/[a-z0-9-]{1,120}(?:/offers/[a-z0-9-]{1,120})?$`);
const credential = new RegExp(`^/api/rewards/claims/${id}/credential$`);
const adminGet = new Set(["organisations", "overview", "readiness"].map(s => `/api/admin/retail-rewards/pilot/${s}`));
const adminPost = new Set(["prepare", "publishShop", "approveOffer", "invite", "reissue", "revoke"].map(s => `/api/admin/retail-rewards/pilot/${s}`));
export function pilotPreviewRoute(path, method, hasServerAction = false) {
  if (typeof path !== "string" || path.includes("%") || path.includes("\\") || hasServerAction) return null;
  if (reads.has(method) && ["/rewards/pilot-sign-in", "/rewards/sign-in", "/rewards/accept-invitation"].includes(path)) return "BOOTSTRAP";
  if (method === "POST" && ["/api/retail-rewards/pilot-login", "/api/rewards/auth/login", "/api/rewards/auth/invitation", "/api/rewards/auth/logout"].includes(path)) return "BOOTSTRAP";
  if (reads.has(method) && path.startsWith("/_next/static/") && !path.includes("..")) return "ASSET";
  if ((reads.has(method) && (path === "/admin/retail-rewards/pilot" || adminGet.has(path))) || method === "POST" && adminPost.has(path)) return "ADMIN";
  if (reads.has(method) && (merchantPages.has(path) || merchantGet.has(path) || path === "/api/retail-rewards/campaign-review/offers")) return "MERCHANT";
  if (method === "POST" && (merchantPost.has(path) || offerAction.test(path) || path === "/api/retail-rewards/campaign-links/review")) return "MERCHANT";
  if (method === "PATCH" && offerRead.test(path)) return "MERCHANT";
  if (reads.has(method) && path === "/api/retail-rewards/staff/overview" || method === "POST" && /^\/api\/retail-rewards\/staff\/(?:save|revoke)$/.test(path)) return "MERCHANT";
  if (reads.has(method) && (["/rewards", "/rewards/wallet", "/api/rewards/discovery/shops", "/api/rewards/claims"].includes(path) || shopRead.test(path))) return "SHOPPER";
  if (method === "POST" && (path === "/api/rewards/claims" || credential.test(path))) return "SHOPPER";
  return null;
}
